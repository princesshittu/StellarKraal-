# Staging deployment guide

This guide describes how StellarKraal’s **staging** environment is deployed using the repository’s GitHub Actions workflow and Docker Compose overrides. For high-level staging URLs and secrets, see also the [README](../../README.md#staging-environment) and [STAGING.md](../../STAGING.md).

## Overview

- **Trigger:** merges (pushes) to the `main` branch run the [Deploy to Staging](../../.github/workflows/deploy-staging.yml) workflow.
- **Runtime:** Docker Compose with `docker-compose.yml` plus `docker-compose.staging.yml` (Stellar **testnet**, staging contract ID, staging URLs).
- **Network:** Soroban testnet RPC (default `https://soroban-testnet.stellar.org` if `STAGING_RPC_URL` is unset locally).

Example URLs used in documentation (replace with your deployed hosts):

| Service | Example URL |
|---------|-------------|
| Frontend | `https://staging.stellarkraal.example.com` |
| Backend API | `https://api-staging.stellarkraal.example.com` |

## Prerequisites

### Repository access

- Permission to merge to `main` (or to run/re-run the **Deploy to Staging** workflow on `main`).
- Access to the GitHub **staging** environment and its secrets (Settings → Environments → staging).

### Runner / host (CI)

The deploy job runs on `ubuntu-latest` and requires:

- **Docker** and **Docker Compose** (used to run `docker compose ... up -d --build`).
- **Node.js 20** (used in the preceding lint/test job).

### Local staging stack (optional)

To mirror staging on a developer machine:

- Docker & Docker Compose
- `.env` at the repo root (from `env.example`)
- Staging variables exported or set in `.env`: `STAGING_RPC_URL`, `STAGING_CONTRACT_ID`, `STAGING_API_URL`, `STAGING_FRONTEND_URL`, `JWT_SECRET`

See [Docker Compose guide](../guides/docker.md#compose-file-variants) for the exact compose command.

## Required GitHub Secrets

Configure these under **Settings → Environments → staging** (and ensure `SLACK_WEBHOOK_URL` is available for notifications):

| Secret | Used by deploy job | Purpose |
|--------|-------------------|---------|
| `STAGING_RPC_URL` | `docker compose` env | Soroban testnet JSON-RPC URL for the backend (`RPC_URL`) |
| `STAGING_CONTRACT_ID` | `docker compose` env | Staging Soroban contract ID (`CONTRACT_ID`) |
| `STAGING_API_URL` | `docker compose` env | Public backend URL (`NEXT_PUBLIC_API_URL` for frontend build/runtime) |
| `STAGING_FRONTEND_URL` | `docker compose` env | Frontend origin for backend CORS (`FRONTEND_URL`) |
| `JWT_SECRET` | `docker compose` env | JWT signing key for staging backend |
| `SLACK_WEBHOOK_URL` | Slack notify job | Incoming webhook for deployment success/failure messages |

`docker-compose.staging.yml` documents the same staging secret names in its header comment.

## Deployment process

The [Deploy to Staging](../../.github/workflows/deploy-staging.yml) workflow has three jobs:

### 1. Lint and Test (`test`)

Runs on every qualifying push to `main`:

1. Checkout repository.
2. **Frontend:** `npm ci`, `npm run lint`, `npm test -- --watchAll=false`.
3. **Backend:** `npm ci`, `npm run lint`, `npm test -- --watchAll=false`.

The deploy job does **not** start unless this job succeeds.

### 2. Deploy to Staging (`deploy-staging`)

- **Environment:** GitHub `staging` (environment protection rules apply if configured).
- **Command:**

  ```bash
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.staging.yml \
    up -d --build
  ```

- **Environment variables** passed from secrets: `STAGING_RPC_URL`, `STAGING_CONTRACT_ID`, `STAGING_API_URL`, `STAGING_FRONTEND_URL`, `JWT_SECRET`.

`docker-compose.staging.yml` sets `NODE_ENV=staging`, testnet `NEXT_PUBLIC_NETWORK`, log rotation (`max-size: 10m`, `max-file: 3`), and wires backend/frontend env as shown in that file.

### 3. Slack Notification (`notify`)

- Runs `if: always()` after deploy.
- Posts **Staging Deployment Status** (success/failure) to Slack via `SLACK_WEBHOOK_URL`, with a link to the workflow run.

## Triggering deployments

| Method | Behavior |
|--------|----------|
| **Merge to `main`** | Automatically runs the full workflow (test → deploy → notify). |
| **Re-run workflow** | In GitHub Actions, open a previous **Deploy to Staging** run → **Re-run all jobs** (same commit). |
| **Deploy a specific commit** | Use **Run workflow** if enabled, or push/merge that commit to `main`; alternatively deploy manually (below). |

### Manual deploy (same as CI)

On a host with Docker and the repo checked out at the desired commit:

```bash
export STAGING_RPC_URL="..."
export STAGING_CONTRACT_ID="..."
export STAGING_API_URL="..."
export STAGING_FRONTEND_URL="..."
export JWT_SECRET="..."

docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

## Monitoring deployment progress

1. **GitHub Actions:** Repository → Actions → **Deploy to Staging** → select the run. Confirm `Lint and Test` then `Deploy to Staging` are green.
2. **Slack:** Check the channel configured for `SLACK_WEBHOOK_URL` for the deployment status attachment.
3. **Containers (on the deploy host):**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
   docker compose -f docker-compose.yml -f docker-compose.staging.yml logs -f backend frontend
   ```

4. **Health checks:** Base `docker-compose.yml` defines health checks for backend (`GET /api/health`) and frontend (`GET /` on port 3000); frontend waits until backend is healthy.

## Rollback procedure

The staging workflow does not define an automatic rollback job. Use one of the following:

### Option A: Re-deploy a known-good commit (preferred)

1. Identify the last successful **Deploy to Staging** run on GitHub Actions.
2. **Re-run all jobs** on that workflow run, **or** check out that commit on the staging host and run the [manual deploy](#manual-deploy-same-as-ci) command again.

### Option B: Compose rollback on the host

1. Check out the previous stable Git commit on the server.
2. Rebuild and recreate containers:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
   ```

3. Verify [post-deployment validation](#post-deployment-validation).

For broader rollback patterns (CI re-run vs manual Docker), see [deployment rollback runbook](../runbooks/deployment-rollback.md).

## Post-deployment validation

### API health

```bash
curl -sS "${STAGING_API_URL}/api/health" | jq .
# or versioned:
curl -sS "${STAGING_API_URL}/api/v1/health" | jq .
```

Expect `status: "healthy"` when RPC is reachable (or `degraded` with details if RPC is down).

### Contract and RPC (optional)

From the repo root, run the verification script with staging contract settings:

```bash
RPC_URL="$STAGING_RPC_URL" \
CONTRACT_ID="$STAGING_CONTRACT_ID" \
ADMIN_ADDRESS="<your_staging_admin_public_key>" \
NEXT_PUBLIC_NETWORK=testnet \
npm run verify:deployment
```

The script (`scripts/verify-deployment.ts`) checks configuration, RPC health, and basic contract simulations; it exits with code `1` on failure.

### Frontend smoke test

1. Open `STAGING_FRONTEND_URL` in a browser.
2. Confirm the app loads and API calls target `STAGING_API_URL` (network tab / configured `NEXT_PUBLIC_API_URL`).
3. Exercise a read-only path (for example health or loan list) before testing wallet flows.

## Testing the staging environment

- **Automated:** The deploy workflow already runs frontend and backend unit tests before deploy; backend integration tests run on `main` via [Backend Integration Tests](../../.github/workflows/integration-tests.yml) (separate workflow, testnet `RPC_URL`).
- **Manual QA:** Use testnet wallets (Freighter) against the staging contract ID; do not use production keys or mainnet assets.
- **Logs:** Use [container logs runbook](../runbooks/container-logs.md) patterns with the staging compose files.
- **Troubleshooting:** [docs/troubleshooting.md](../troubleshooting.md) for CORS, JWT, RPC, and migration issues.

## Terraform Infrastructure Deployment

StellarKraal's AWS infrastructure (ECS Fargate, RDS, S3, VPC, SNS/CloudWatch alerting) is
managed with Terraform. This section covers how to run Terraform commands locally for the
staging environment, and what to do when something goes wrong.

For CI-driven Terraform runs, see the [`terraform.yml`](../../.github/workflows/terraform.yml)
workflow and the [CI/CD guide](../guides/ci-cd.md#infrastructure-terraform).

---

### Prerequisites

Before running any Terraform command locally, ensure the following are installed and configured:

| Requirement | Minimum version | Notes |
|-------------|-----------------|-------|
| [Terraform CLI](https://developer.hashicorp.com/terraform/downloads) | **1.6+** | Verify: `terraform version` |
| [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) | **2.x** | Verify: `aws --version` |
| AWS credentials | — | Use IAM role or `aws configure`; see below |
| S3 remote state bucket | — | Value in the `TF_STATE_BUCKET` GitHub variable |

#### AWS credentials

The CI workflow uses OIDC (no long-lived keys). For local runs, authenticate with the AWS
CLI using a profile or environment variables:

```bash
# Option A — named profile (recommended)
aws configure --profile stellarkraal-staging
export AWS_PROFILE=stellarkraal-staging

# Option B — environment variables
export AWS_ACCESS_KEY_ID="<your-key>"
export AWS_SECRET_ACCESS_KEY="<your-secret>"
export AWS_REGION="us-east-1"   # or your configured region
```

Verify your identity before proceeding:

```bash
aws sts get-caller-identity
# Expected output:
# {
#   "UserId": "AIDAEXAMPLEID",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/your-username"
# }
```

---

### Step 1 — Initialise the workspace

Run `terraform init` from the `infrastructure/` directory. This downloads provider plugins and
configures the S3 remote backend.

```bash
cd infrastructure

terraform init \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="key=staging/terraform.tfstate" \
  -backend-config="region=${AWS_REGION}"
```

Expected output (abbreviated):

```
Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.x.x...

Terraform has been successfully initialized!
```

If you see `Error: Failed to get existing workspaces`, confirm the S3 bucket exists and your
credentials have `s3:GetObject` / `s3:PutObject` permissions on it.

Select (or create) the staging workspace:

```bash
terraform workspace select staging || terraform workspace new staging
```

---

### Step 2 — Review the plan

Generate a plan to see exactly what Terraform would change. **Always review the plan before
applying**, especially for the staging environment.

```bash
terraform plan \
  -var-file="staging.tfvars" \
  -out=staging.tfplan
```

Expected output (abbreviated):

```
Terraform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  ~ update in-place
  + create

Plan: 2 to add, 1 to change, 0 to destroy.
```

Key things to check in the plan output:

- **Destroys** (`-`) — any resource being destroyed should be intentional. A surprise destroy
  on an ECS service, RDS instance, or S3 bucket warrants investigation before applying.
- **Replacements** (`-/+`) — indicate the resource must be torn down and re-created. Verify
  the replacement is acceptable (no data loss).
- **In-place updates** (`~`) — least disruptive; review the attribute changes shown.

The plan is saved to `staging.tfplan` so the apply step uses exactly the reviewed plan.

---

### Step 3 — Apply

Apply the saved plan:

```bash
terraform apply staging.tfplan
```

Expected output (abbreviated):

```
aws_ecs_service.backend: Modifying... [id=arn:aws:ecs:us-east-1:...]
aws_ecs_service.backend: Modifications complete after 12s

Apply complete! Resources: 2 added, 1 changed, 0 destroyed.

Outputs:
  staging_api_url     = "https://api-staging.stellarkraal.example.com"
  staging_frontend_url = "https://staging.stellarkraal.example.com"
```

After apply completes, run the [post-deployment validation](#post-deployment-validation) steps
to confirm the staging stack is healthy.

---

### Rollback procedure

#### Option A — Revert via a previous state snapshot (preferred)

Terraform state is versioned in S3 (if versioning is enabled on the bucket). To roll back
infrastructure to a prior state:

1. List available state versions in the S3 console or via the AWS CLI:
   ```bash
   aws s3api list-object-versions \
     --bucket "${TF_STATE_BUCKET}" \
     --prefix "staging/terraform.tfstate" \
     --query 'Versions[*].{VersionId:VersionId,LastModified:LastModified}' \
     --output table
   ```
2. Download the desired previous state:
   ```bash
   aws s3api get-object \
     --bucket "${TF_STATE_BUCKET}" \
     --key "staging/terraform.tfstate" \
     --version-id "<target-version-id>" \
     terraform.tfstate.backup
   ```
3. Push it as the current state:
   ```bash
   terraform state push terraform.tfstate.backup
   ```
4. Run `terraform plan` to confirm the state matches the desired infrastructure, then `terraform apply` to reconcile any drift.

#### Option B — Revert the code change and re-apply

If the infrastructure drift was introduced by a code change (e.g., a variable change in
`staging.tfvars`):

1. Revert the change in the `infrastructure/` directory (git revert or manual edit).
2. Run `terraform plan -var-file="staging.tfvars"` to confirm the plan restores the previous state.
3. Run `terraform apply` to apply the restore plan.

This is the preferred option for most day-to-day mistakes (wrong variable value, wrong image
tag, etc.).

#### Option C — Destroy and re-create a single resource

For a single misbehaving resource (e.g., an ECS task definition that won't start):

```bash
# Taint the resource so the next apply replaces it
terraform taint aws_ecs_task_definition.backend

# Preview the replacement
terraform plan -var-file="staging.tfvars"

# Apply the replacement
terraform apply -var-file="staging.tfvars"
```

> **Warning:** `terraform taint` schedules the resource for destruction and re-creation on
> the next apply. Do not taint stateful resources (RDS instances, S3 buckets) without
> understanding the data implications.

---

### Common Terraform errors and resolutions

| Error | Cause | Resolution |
|-------|-------|------------|
| `Error: configuring Terraform AWS Provider: no valid credential sources found` | AWS credentials not configured | Run `aws configure` or export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` |
| `Error: Failed to get existing workspaces: S3 bucket does not exist` | S3 backend bucket missing or wrong name | Confirm `TF_STATE_BUCKET` matches an existing bucket in the correct region; create the bucket if necessary |
| `Error: Invalid AWS Region: ` | `AWS_REGION` not set | Export `AWS_REGION` or pass `-backend-config="region=us-east-1"` to `terraform init` |
| `Error acquiring the state lock` | Another `terraform apply` is in progress, or a previous run crashed without releasing the lock | Wait for the other run to complete, or force-unlock: `terraform force-unlock <lock-id>` (confirm no active apply first) |
| `Error: creating ECS Service … Fargate requires task definition with networkMode awsvpc` | Task definition uses wrong network mode | Ensure the ECS task definition in Terraform uses `network_mode = "awsvpc"` |
| `Error: Error modifying RDS Instance … Cannot upgrade to a lower version` | Downgrading the RDS engine version | Engine downgrades are not supported; restore from a snapshot instead |
| `Error: timeout waiting for ECS Service ... to reach steady state` | ECS tasks failing health checks or crashing on startup | Check ECS task logs in CloudWatch: `aws logs tail /ecs/stellarkraal-staging-backend --follow` |
| `Plan: X to destroy` unexpectedly | Resource configuration changed in a way Terraform cannot update in-place | Review which attribute triggered the replacement; check if a `lifecycle { prevent_destroy = true }` block should be added |
| `InvalidClientTokenId: The security token included in the request is invalid` | Expired or wrong AWS credentials | Re-authenticate: `aws sso login` or refresh the session token |

---

## Related documentation

- [STAGING.md](../../STAGING.md) — additional staging notes (verify against this guide for CI behavior).
- [README staging section](../../README.md#staging-environment)
- [CI/CD guide — Infrastructure (Terraform)](../guides/ci-cd.md#infrastructure-terraform)
- [Infrastructure Terraform reference](../infrastructure/terraform.md)
- [Secrets rotation](../security/secrets-rotation.md)
- [Docker Compose variants](../guides/docker.md#compose-file-variants)
