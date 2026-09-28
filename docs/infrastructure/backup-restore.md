# S3 Backup and Restore Procedure

StellarKraal stores database dumps and application artefacts in an AWS S3 bucket. This
document covers the automatic backup schedule, how to trigger a manual backup, how to
restore from a backup, and the RTO/RPO targets that the procedure is designed to meet.

> For the RDS-level (AWS Backup) restore procedure see
> [docs/recovery/restore-procedure.md](../recovery/restore-procedure.md).
> For the full disaster-recovery playbook see
> [docs/recovery/disaster-recovery.md](../recovery/disaster-recovery.md).

---

## Contents

1. [Architecture Overview](#architecture-overview)
2. [Backup Schedule and Retention Policy](#backup-schedule-and-retention-policy)
3. [RTO and RPO Targets](#rto-and-rpo-targets)
4. [Prerequisites](#prerequisites)
5. [Manual Backup Trigger](#manual-backup-trigger)
6. [Restore Procedure](#restore-procedure)
7. [RDS PostgreSQL Backup and Restore](#rds-postgresql-backup-and-restore)
8. [Verification Checklist](#verification-checklist)
9. [Runbook Reference](#runbook-reference)

---

## Architecture Overview

```
Backend ECS task
       │
       │  pg_dump / sqlite3 .dump
       ▼
  /tmp/backup-<date>.sql.gz
       │
       │  aws s3 cp
       ▼
  s3://stellarkraal-backups-<env>/db/
       │
       │  lifecycle rule (see retention policy)
       ▼
  Glacier Deep Archive (after 90 days)
```

- **Bucket name pattern**: `stellarkraal-backups-staging` and `stellarkraal-backups-production`
- **Prefix structure**: `db/YYYY/MM/DD/backup-<timestamp>.sql.gz`
- **Encryption**: AES-256 (SSE-S3) — no extra KMS key is required for standard restores
- **Versioning**: enabled on all backup buckets; accidental overwrites can be recovered with `aws s3api list-object-versions`

---

## Backup Schedule and Retention Policy

| Schedule | Trigger | Retention |
|----------|---------|-----------|
| Nightly at 02:00 UTC | EventBridge rule → ECS Scheduled Task | 30 days in S3 Standard |
| Weekly (Sunday 03:00 UTC) | EventBridge rule → ECS Scheduled Task | 90 days in S3 Standard, then moved to Glacier Deep Archive for 1 year |
| Manual (on demand) | AWS CLI / GitHub Actions workflow_dispatch | No lifecycle rule applied — tag `manual=true` for tracking |

Lifecycle rules are defined in the `s3` Terraform module (`infrastructure/modules/s3/main.tf`).
To change them, update the `lifecycle_rules` variable and re-apply:

```bash
terraform workspace select production
terraform apply -var-file="envs/production.tfvars" -target=module.s3
```

---

## RTO and RPO Targets

| Target | Value | Notes |
|--------|-------|-------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours | At most 24 hours of data may be lost; nightly backups ensure the worst-case loss is one day |
| **RTO** (Recovery Time Objective) | ≤ 4 hours | The time from declaring an incident to a fully operational restored environment, including ECS restart and smoke tests |

These targets assume:
- A trained on-call engineer following this runbook.
- S3 is accessible and the backup objects are intact.
- The target RDS / PostgreSQL instance is available (new or existing).

If the S3 bucket itself is unavailable, fall back to the weekly Glacier archive. Glacier
retrieval adds 12–48 hours to the RTO depending on the retrieval tier selected.

---

## Prerequisites

Before running any backup or restore command, ensure you have:

- AWS CLI v2 authenticated with a profile that has the following permissions:
  - `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the backup bucket
  - `ecs:RunTask` on the `stellarkraal-<env>` cluster (for manual backup)
  - `rds:RestoreDBInstanceFromDBSnapshot` (if restoring the RDS instance as well)
- The correct AWS profile configured: `AWS_PROFILE=stellarkraal-<env>` or equivalent
- `DATABASE_URL` of the target instance available (for restore)
- `psql` (PostgreSQL) or `sqlite3` CLI installed locally

Verify access:

```bash
aws s3 ls s3://stellarkraal-backups-production/db/ --profile stellarkraal-production
```

---

## Manual Backup Trigger

### Option A — GitHub Actions (recommended)

Navigate to **Actions → "Manual S3 Backup"** in the GitHub repository and click
**Run workflow**. Select the target environment (`staging` or `production`) and confirm.

The workflow:
1. Triggers an ECS one-off task using the `backup` container definition.
2. The task runs `pg_dump` (or `sqlite3 .dump` for the SQLite development profile).
3. Compresses the output with `gzip`.
4. Uploads to `s3://stellarkraal-backups-<env>/db/<date>/backup-<timestamp>.sql.gz`.
5. Tags the object with `manual=true` and the triggering actor's GitHub username.

### Option B — AWS CLI

Run the ECS backup task directly:

```bash
aws ecs run-task \
  --cluster stellarkraal-production \
  --task-definition stellarkraal-backup \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-id>],securityGroups=[<sg-id>],assignPublicIp=DISABLED}" \
  --profile stellarkraal-production \
  --region us-east-1
```

Replace `<subnet-id>` and `<sg-id>` with the private subnet and backend security group IDs
from Terraform outputs:

```bash
terraform -chdir=infrastructure output private_subnet_ids
terraform -chdir=infrastructure output backend_security_group_id
```

Wait for the task to reach `STOPPED` status:

```bash
aws ecs wait tasks-stopped \
  --cluster stellarkraal-production \
  --tasks <task-arn> \
  --profile stellarkraal-production \
  --region us-east-1
```

Confirm the object was written:

```bash
aws s3 ls "s3://stellarkraal-backups-production/db/$(date +%Y/%m/%d)/" \
  --profile stellarkraal-production
```

### Option C — Local script (staging only)

For staging environments with direct database access:

```bash
# PostgreSQL
pg_dump "$DATABASE_URL" | gzip > /tmp/backup-$(date +%Y%m%d-%H%M%S).sql.gz
aws s3 cp /tmp/backup-*.sql.gz \
  "s3://stellarkraal-backups-staging/db/$(date +%Y/%m/%d)/" \
  --profile stellarkraal-staging

# SQLite (local dev only)
sqlite3 backend/dev.sqlite3 .dump | gzip > /tmp/backup-$(date +%Y%m%d-%H%M%S).sql.gz
aws s3 cp /tmp/backup-*.sql.gz \
  "s3://stellarkraal-backups-staging/db/$(date +%Y/%m/%d)/" \
  --profile stellarkraal-staging
```

---

## Restore Procedure

> This procedure has been tested against the staging environment.
> Always restore to a **new or isolated** database instance first and validate data
> before cutting over production traffic.

### Step 1 — Identify the target backup

List available backups for a date range:

```bash
# List all backups for the last 7 days
aws s3 ls s3://stellarkraal-backups-production/db/ --recursive \
  --profile stellarkraal-production \
  | grep "sql.gz" \
  | tail -20
```

Note the full S3 key of the backup you want to restore (e.g.,
`db/2026/08/28/backup-20260828-020005.sql.gz`).

### Step 2 — Download the backup

```bash
aws s3 cp \
  "s3://stellarkraal-backups-production/db/2026/08/28/backup-20260828-020005.sql.gz" \
  /tmp/restore.sql.gz \
  --profile stellarkraal-production
```

Verify the file is intact:

```bash
gunzip --test /tmp/restore.sql.gz && echo "OK"
```

### Step 3 — Create the target database (if needed)

If you are restoring to a new RDS instance, provision it first and wait until it reaches
`Available` status. See [docs/recovery/restore-procedure.md](../recovery/restore-procedure.md)
for the RDS creation steps.

For an existing instance, create a new database to restore into (avoiding overwriting live data):

```bash
# PostgreSQL: create a restore-target database
psql "$ADMIN_DATABASE_URL" -c "CREATE DATABASE stellarkraal_restore;"
```

### Step 4 — Restore the dump

**PostgreSQL:**

```bash
# Decompress and pipe directly into psql
gunzip --stdout /tmp/restore.sql.gz \
  | psql "postgres://<user>:<password>@<host>:5432/stellarkraal_restore"
```

**SQLite:**

```bash
gunzip --stdout /tmp/restore.sql.gz \
  | sqlite3 /tmp/stellarkraal_restore.sqlite3
```

Monitor progress — large dumps can take several minutes. You should see SQL statements
streaming through the terminal.

### Step 5 — Verify data integrity

After the restore completes, run basic sanity checks:

```bash
# PostgreSQL
psql "postgres://<user>:<password>@<host>:5432/stellarkraal_restore" \
  -c "SELECT COUNT(*) FROM loans;"
psql "postgres://<user>:<password>@<host>:5432/stellarkraal_restore" \
  -c "SELECT COUNT(*) FROM collateral;"
psql "postgres://<user>:<password>@<host>:5432/stellarkraal_restore" \
  -c "SELECT MAX(created_at) FROM loans;"

# SQLite
sqlite3 /tmp/stellarkraal_restore.sqlite3 "SELECT COUNT(*) FROM loans;"
sqlite3 /tmp/stellarkraal_restore.sqlite3 "SELECT COUNT(*) FROM collateral;"
```

Compare the row counts and latest `created_at` against the production instance to confirm
the restore captured the expected data.

### Step 6 — Point the application at the restored database

Update `DATABASE_URL` in the ECS task definition (or `.env` for local testing) to point
to the restored database:

```bash
# Update the ECS task definition via AWS CLI or Terraform
# For a quick staging test, export the variable locally:
export DATABASE_URL="postgres://<user>:<password>@<restored-host>:5432/stellarkraal_restore"
cd backend && npm run build && npm start
```

### Step 7 — Smoke test the application

With the backend running against the restored database:

```bash
# Health check
curl -s http://localhost:3001/api/v1/health | jq .

# List loans
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/v1/loans | jq '.data | length'
```

If the smoke tests pass, update the production `DATABASE_URL` and restart the ECS service:

```bash
aws ecs update-service \
  --cluster stellarkraal-production \
  --service stellarkraal-backend \
  --force-new-deployment \
  --profile stellarkraal-production \
  --region us-east-1
```

### Step 8 — Notify stakeholders

Post an incident update to the #on-call Slack channel (or the active PagerDuty incident)
with:

- The backup timestamp used for restoration
- Row counts before and after
- Time of cutover
- Any data loss window (time between last backup and incident)

---

---

## RDS PostgreSQL Backup and Restore

StellarKraal's production and staging databases run on **AWS RDS PostgreSQL**. In addition
to the application-level `pg_dump` backups described above, RDS provides its own
automated backup and snapshot mechanisms that operate at the storage level.  Both
layers are active in production; use whichever best matches the recovery scenario.

> **Terraform resource references:** The RDS instance and its backup settings are
> managed in `infrastructure/modules/rds/main.tf`. All AWS CLI examples below assume
> the `stellarkraal-production` AWS profile; substitute `stellarkraal-staging` as needed.

---

### RDS RTO and RPO Targets

| Target | Value | Notes |
|--------|-------|-------|
| **RPO** (Recovery Point Objective) | ≤ 5 minutes | Continuous automatic backups with transaction log archival allow PITR to any 5-minute window within the retention period |
| **RTO** (Recovery Time Objective) | ≤ 1 hour | Restoring to a new RDS instance from a snapshot or PITR typically completes in 20–40 minutes; ECS service restart and smoke tests add ≤ 20 minutes |

These targets apply to the RDS-level restore path. The application-level `pg_dump`
path carries the broader 24-hour RPO / 4-hour RTO stated earlier.

---

### Automated RDS Backup Schedule

RDS automated backups are enabled with a **7-day retention window**. AWS automatically
takes a daily snapshot during the configured maintenance window and continuously
archives transaction logs (WAL) to enable PITR.

| Setting | Value | Terraform variable |
|---------|-------|--------------------|
| Automated backups | Enabled | `backup_retention_period = 7` |
| Backup window | 01:00–02:00 UTC | `backup_window = "01:00-02:00"` |
| Maintenance window | Sunday 05:00–06:00 UTC | `maintenance_window = "sun:05:00-sun:06:00"` |
| Multi-AZ | Yes (production) | `multi_az = true` |
| Deletion protection | Yes (production) | `deletion_protection = true` |

Automated backups are stored in the same AWS region as the instance. They are **not**
transferred to S3 and are distinct from the `pg_dump` objects described earlier.

Verify the current backup configuration:

```bash
aws rds describe-db-instances \
  --db-instance-identifier stellarkraal-production \
  --query 'DBInstances[0].{BackupRetentionPeriod:BackupRetentionPeriod,BackupWindow:PreferredBackupWindow,MultiAZ:MultiAZ}' \
  --profile stellarkraal-production \
  --region us-east-1
```

---

### Manual RDS Snapshot Creation

Take a manual snapshot before any schema migration, major release, or planned
maintenance. Manual snapshots are not subject to the 7-day automated retention limit
and persist until explicitly deleted.

```bash
# Create a manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier stellarkraal-production \
  --db-snapshot-identifier "stellarkraal-production-pre-migration-$(date +%Y%m%d-%H%M%S)" \
  --tags Key=reason,Value=pre-migration Key=triggered-by,Value=<your-name> \
  --profile stellarkraal-production \
  --region us-east-1

# Wait for the snapshot to become available (typically 5–15 minutes)
aws rds wait db-snapshot-available \
  --db-instance-identifier stellarkraal-production \
  --db-snapshot-identifier "stellarkraal-production-pre-migration-<TIMESTAMP>" \
  --profile stellarkraal-production \
  --region us-east-1

# Verify the snapshot is available
aws rds describe-db-snapshots \
  --db-instance-identifier stellarkraal-production \
  --query 'DBSnapshots[*].{ID:DBSnapshotIdentifier,Status:Status,CreatedAt:SnapshotCreateTime}' \
  --profile stellarkraal-production \
  --region us-east-1
```

List all available snapshots (automated + manual):

```bash
aws rds describe-db-snapshots \
  --db-instance-identifier stellarkraal-production \
  --snapshot-type manual \
  --query 'DBSnapshots[*].{ID:DBSnapshotIdentifier,Status:Status,AllocatedStorage:AllocatedStorage,CreatedAt:SnapshotCreateTime}' \
  --output table \
  --profile stellarkraal-production \
  --region us-east-1
```

---

### Point-in-Time Restore (PITR)

RDS PITR lets you restore the database to any point within the automated backup
retention window (up to 7 days). This is the fastest path to recovering from
accidental data deletion or corruption with minimal data loss.

> PITR **always** creates a **new** DB instance. It does not modify the source.
> The restored instance must be validated before cutting over application traffic.

**Step 1 — Identify the restore point**

Choose a timestamp just before the incident:

```bash
# View the earliest available restore time
aws rds describe-db-instances \
  --db-instance-identifier stellarkraal-production \
  --query 'DBInstances[0].{EarliestRestoreTime:EarliestRestorableTime,LatestRestoreTime:LatestRestorableTime}' \
  --profile stellarkraal-production \
  --region us-east-1
```

**Step 2 — Initiate the PITR restore**

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier stellarkraal-production \
  --target-db-instance-identifier stellarkraal-production-pitr-$(date +%Y%m%d-%H%M%S) \
  --restore-time "2026-09-25T14:30:00Z" \
  --db-instance-class db.t3.medium \
  --no-multi-az \
  --publicly-accessible \
  --vpc-security-group-ids <sg-id> \
  --db-subnet-group-name stellarkraal-production-subnet-group \
  --profile stellarkraal-production \
  --region us-east-1
```

Replace `--restore-time` with the target ISO 8601 UTC timestamp. Retrieve the subnet
group name and security group ID from Terraform:

```bash
terraform -chdir=infrastructure output rds_subnet_group_name
terraform -chdir=infrastructure output rds_security_group_id
```

**Step 3 — Wait for the restored instance to become available**

```bash
aws rds wait db-instance-available \
  --db-instance-identifier stellarkraal-production-pitr-<TIMESTAMP> \
  --profile stellarkraal-production \
  --region us-east-1
```

This typically takes 10–30 minutes depending on database size.

**Step 4 — Retrieve the restored instance endpoint**

```bash
aws rds describe-db-instances \
  --db-instance-identifier stellarkraal-production-pitr-<TIMESTAMP> \
  --query 'DBInstances[0].Endpoint.{Address:Address,Port:Port}' \
  --profile stellarkraal-production \
  --region us-east-1
```

**Step 5 — Validate the restored database**

Connect and run sanity checks before cutting over traffic:

```bash
# Set a temporary DATABASE_URL for the restored instance
export RESTORED_DB_URL="postgres://<user>:<password>@<restored-endpoint>:5432/stellarkraal"

psql "$RESTORED_DB_URL" -c "SELECT COUNT(*) FROM loans;"
psql "$RESTORED_DB_URL" -c "SELECT COUNT(*) FROM collateral;"
psql "$RESTORED_DB_URL" -c "SELECT MAX(created_at) FROM loans;"
```

Compare results against the current production values.

**Step 6 — Cut over application traffic**

Update the ECS task definition `DATABASE_URL` secret in AWS Secrets Manager (or SSM
Parameter Store) to point to the restored instance, then trigger a new ECS deployment:

```bash
# Update the secret
aws secretsmanager put-secret-value \
  --secret-id stellarkraal/production/DATABASE_URL \
  --secret-string "postgres://<user>:<password>@<restored-endpoint>:5432/stellarkraal" \
  --profile stellarkraal-production \
  --region us-east-1

# Force a new ECS deployment to pick up the new secret value
aws ecs update-service \
  --cluster stellarkraal-production \
  --service stellarkraal-backend \
  --force-new-deployment \
  --profile stellarkraal-production \
  --region us-east-1
```

**Step 7 — Clean up**

Once the original (damaged) instance is no longer needed, delete it to avoid unnecessary
costs. Optionally create a final snapshot first:

```bash
aws rds delete-db-instance \
  --db-instance-identifier stellarkraal-production \
  --final-db-snapshot-identifier stellarkraal-production-final-$(date +%Y%m%d) \
  --profile stellarkraal-production \
  --region us-east-1
```

---

### Restore from a Manual Snapshot

To restore a specific manual snapshot (rather than a PITR timestamp):

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier stellarkraal-production-restored-$(date +%Y%m%d) \
  --db-snapshot-identifier "stellarkraal-production-pre-migration-<TIMESTAMP>" \
  --db-instance-class db.t3.medium \
  --vpc-security-group-ids <sg-id> \
  --db-subnet-group-name stellarkraal-production-subnet-group \
  --no-multi-az \
  --profile stellarkraal-production \
  --region us-east-1
```

Then follow Steps 3–7 of the PITR procedure above.

---

### Terraform Resource References

All RDS backup settings are managed in Terraform. Key files:

| Resource | File | Key variables |
|----------|------|---------------|
| RDS instance | `infrastructure/modules/rds/main.tf` | `backup_retention_period`, `backup_window`, `maintenance_window`, `multi_az`, `deletion_protection` |
| RDS subnet group | `infrastructure/modules/rds/main.tf` | `db_subnet_group_name` |
| Security groups | `infrastructure/modules/vpc/main.tf` | `rds_security_group_id` |
| Environment-specific overrides | `infrastructure/envs/production.tfvars` | All production values |

To modify the backup retention window and apply the change:

```bash
# Edit infrastructure/envs/production.tfvars:
# backup_retention_period = 14   # increase to 14 days

terraform workspace select production
terraform plan -var-file="envs/production.tfvars" -target=module.rds
terraform apply -var-file="envs/production.tfvars" -target=module.rds
```

> **Changing `backup_retention_period` from 0 (disabled) to any positive value will
> cause a brief (< 1 minute) storage configuration change on the instance but will
> not restart or interrupt it.**

---

## Verification Checklist

Run this checklist every quarter as part of the on-call rotation:

**S3 / pg_dump backups:**

- [ ] Confirm nightly backup jobs ran successfully for the last 30 days (check CloudWatch
  Logs for the `stellarkraal-backup` ECS task).
- [ ] Trigger a manual backup via the GitHub Actions workflow and confirm the object appears
  in S3 within 15 minutes.
- [ ] Download the most recent backup and verify it decompresses without errors
  (`gunzip --test`).
- [ ] Restore the most recent backup to a **temporary staging database** and verify row
  counts match production within the expected delta.
- [ ] Confirm the lifecycle rules are in place: `aws s3api get-bucket-lifecycle-configuration --bucket stellarkraal-backups-production`.
- [ ] Confirm bucket versioning is enabled: `aws s3api get-bucket-versioning --bucket stellarkraal-backups-production`.
- [ ] Delete the temporary staging database after verification.

**RDS PostgreSQL backups:**

- [ ] Verify automated backups are enabled and `BackupRetentionPeriod` ≥ 7:
  `aws rds describe-db-instances --db-instance-identifier stellarkraal-production --query 'DBInstances[0].BackupRetentionPeriod'`.
- [ ] Take a manual snapshot and confirm it reaches `available` status within 15 minutes.
- [ ] Perform a test PITR restore to a temporary instance in **staging** and verify row counts.
- [ ] Confirm the restored staging instance is deleted after validation.
- [ ] Confirm `deletion_protection = true` is still set on the production RDS instance.
- [ ] Record the result in the on-call rotation log.

| Last validated by | Date | Result |
|-------------------|------|--------|
| | | |

---

## Runbook Reference

This document is linked from the on-call runbooks. In the event of a data loss incident:

1. Open [docs/runbooks/db-failure.md](../runbooks/db-failure.md) for immediate triage steps.
2. Return here for the detailed restore procedure (Step 1 – Step 8 above).
3. After recovery, open a post-mortem issue and record the incident timeline, RTO achieved,
   and any process improvements.

See also:

- [Infrastructure Terraform Guide](../infrastructure-terraform.md) — S3 module configuration
- [On-Call Rotation](../ON_CALL_ROTATION.md) — escalation paths and contacts
- [Disaster Recovery](../recovery/disaster-recovery.md) — full DR playbook including multi-region failover
- [RDS Restore Procedure](../recovery/restore-procedure.md) — AWS Backup / RDS restore steps
