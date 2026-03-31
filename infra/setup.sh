#!/usr/bin/env bash
# Run once to provision all AWS resources.
# Prerequisites: aws CLI configured, jq installed.
set -euo pipefail

APP="field-quote"
REGION="us-east-1"
DB_USER="fieldquote"
DB_NAME="fieldquote"
DB_PASS=$(openssl rand -base64 16 | tr -d '/+=')

echo "==> Creating S3 buckets"
aws s3 mb s3://${APP}-frontend --region $REGION
aws s3 mb s3://${APP}-photos   --region $REGION

# Block public access on photos bucket
aws s3api put-public-access-block \
  --bucket ${APP}-photos \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "==> Creating RDS Postgres (t3.micro)"
aws rds create-db-instance \
  --db-instance-identifier ${APP}-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username $DB_USER \
  --master-user-password "$DB_PASS" \
  --db-name $DB_NAME \
  --allocated-storage 20 \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --region $REGION

echo "==> Creating Lambda execution role"
ROLE_ARN=$(aws iam create-role \
  --role-name ${APP}-lambda-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' --query 'Role.Arn' --output text)

aws iam attach-role-policy --role-name ${APP}-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
aws iam attach-role-policy --role-name ${APP}-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

echo "==> Storing secrets"
aws secretsmanager create-secret \
  --name ${APP}/db \
  --secret-string "{\"host\":\"FILL_AFTER_RDS_READY\",\"port\":\"5432\",\"database\":\"${DB_NAME}\",\"user\":\"${DB_USER}\",\"password\":\"${DB_PASS}\"}" \
  --region $REGION

aws secretsmanager create-secret \
  --name ${APP}/ai \
  --secret-string "{\"anthropic_api_key\":\"FILL_ME\",\"openai_api_key\":\"FILL_ME\"}" \
  --region $REGION

echo "==> Creating Lambda placeholder"
echo '{"status":"pending"}' > /tmp/placeholder.json
zip /tmp/placeholder.zip /tmp/placeholder.json
aws lambda create-function \
  --function-name ${APP}-api \
  --runtime nodejs20.x \
  --role $ROLE_ARN \
  --handler src/handler.handler \
  --zip-file fileb:///tmp/placeholder.zip \
  --timeout 30 \
  --memory-size 512 \
  --region $REGION

echo "==> Creating API Gateway (HTTP API)"
API_ID=$(aws apigatewayv2 create-api \
  --name ${APP}-api \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","PUT","OPTIONS"]',AllowHeaders='["Content-Type","Authorization"]' \
  --query 'ApiId' --output text --region $REGION)

INTEG_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:${REGION}:$(aws sts get-caller-identity --query Account --output text):function:${APP}-api \
  --payload-format-version 2.0 \
  --region $REGION --query 'IntegrationId' --output text)

aws apigatewayv2 create-route --api-id $API_ID --route-key 'POST /quote'          --target integrations/$INTEG_ID --region $REGION
aws apigatewayv2 create-route --api-id $API_ID --route-key 'GET /pricing-config'  --target integrations/$INTEG_ID --region $REGION
aws apigatewayv2 create-route --api-id $API_ID --route-key 'PUT /pricing-config'  --target integrations/$INTEG_ID --region $REGION

aws apigatewayv2 create-stage --api-id $API_ID --stage-name prod --auto-deploy --region $REGION

echo ""
echo "============================================"
echo "API URL: https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod"
echo "DB password stored in Secrets Manager: ${APP}/db"
echo "Fill in RDS host after instance is ready (~10 min)"
echo "Fill in AI API key in Secrets Manager: ${APP}/ai"
echo "============================================"
