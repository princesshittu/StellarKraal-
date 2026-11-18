output "backup_vault_arn" {
  value = aws_backup_vault.db_backup_vault.arn
}

output "backup_kms_key_arn" {
  value = aws_kms_key.backup_key.arn
}

output "backup_storage_bucket" {
  value = aws_s3_bucket.backup_storage.id
}

output "sns_topic_arn" {
  value = aws_sns_topic.backup_notifications.arn
}

output "ops_alerts_sns_topic_arn" {
  description = "SNS topic that receives all CloudWatch health alarms"
  value       = aws_sns_topic.ops_alerts.arn
}

# ── ECS Auto Scaling outputs (issue #1534) ────────────────────────────────────

output "ecs_autoscaling_policy_arn" {
  description = "ARN of the ECS CPU target-tracking auto-scaling policy for the backend service."
  value       = aws_appautoscaling_policy.backend_cpu.arn
}

output "ecs_autoscaling_min_capacity" {
  description = "Minimum number of ECS tasks (1 for staging, 2 for production)."
  value       = aws_appautoscaling_target.backend.min_capacity
}

output "ecs_autoscaling_max_capacity" {
  description = "Maximum number of ECS tasks allowed by the auto-scaling policy."
  value       = aws_appautoscaling_target.backend.max_capacity
}
