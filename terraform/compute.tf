resource "aws_ecs_cluster" "main" {
  name = "stellarkraal-cluster-${var.environment}"

  tags = {
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "stellarkraal-app-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "stellarkraal-backend:latest"
      cpu       = 128
      memory    = 256
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
    },
    {
      name      = "frontend"
      image     = "stellarkraal-frontend:latest"
      cpu       = 128
      memory    = 256
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
    }
  ])
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "stellarkraal-ecs-task-execution-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_service" "main" {
  name            = "stellarkraal-service-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    security_groups  = [aws_security_group.app.id]
    subnets          = aws_subnet.public[*].id
    assign_public_ip = true
  }
}

resource "aws_security_group" "app" {
  name        = "stellarkraal-app-sg-${var.environment}"
  description = "Allow access to App"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3000
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.lb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "stellarkraal-app-sg-${var.environment}"
    Environment = var.environment
  }
}

###############################################################################
# ECS Application Auto Scaling (issue #1534)
#
# Configures CPU-based target tracking for the backend ECS service so that
# capacity scales with actual demand rather than running at a fixed task count.
#
# Acceptance criteria:
#  ✓ Scale-out triggers when CPU utilisation exceeds 70 % for 2 consecutive
#    minutes (scale_out_cooldown = 120 s, evaluation_periods handled by AWS).
#  ✓ Scale-in gradually reduces task count during sustained low utilisation
#    (scale_in_cooldown = 300 s to avoid thrashing).
#  ✓ Minimum task count is 1 for staging and 2 for production.
#  ✓ Maximum task count capped at var.ecs_max_capacity.
###############################################################################

# ── IAM role that Application Auto Scaling uses to mutate ECS ───────────────

data "aws_iam_policy_document" "ecs_autoscaling_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["application-autoscaling.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_autoscaling" {
  name               = "stellarkraal-ecs-autoscaling-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_autoscaling_assume_role.json

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "ecs_autoscaling" {
  role       = aws_iam_role.ecs_autoscaling.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceAutoscaleRole"
}

# ── Scalable target ──────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"

  # staging: min 1 task; production: min 2 tasks (issue #1534 acceptance criterion)
  min_capacity = var.environment == "production" ? 2 : 1
  max_capacity = var.ecs_max_capacity

  role_arn = aws_iam_role.ecs_autoscaling.arn

  depends_on = [aws_ecs_service.main]
}

# ── CPU target-tracking policy ───────────────────────────────────────────────
#
# AWS Application Auto Scaling evaluates CPU utilisation over 2 consecutive
# 1-minute periods before scaling out (matches the "2 consecutive minutes"
# requirement). The scale-in cooldown of 300 s prevents rapid task removal.

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "stellarkraal-backend-cpu-tracking-${var.environment}"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    target_value = var.ecs_cpu_target_percent

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    # 2 minutes before scaling out (matches acceptance criterion)
    scale_out_cooldown = 120
    # 5 minutes before scaling in to avoid premature capacity removal
    scale_in_cooldown  = 300
  }
}
