#!/bin/bash
set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if project ID is provided
if [ -z "$1" ]; then
    print_error "Usage: ./grovs_android_gcloud_setup.sh <project-id>"
    echo "Example: ./grovs_android_gcloud_setup.sh terraform-testapp-477213"
    exit 1
fi

# Set project ID
export TF_VAR_project_id=$1
print_info "Setting project to: $TF_VAR_project_id"

# Create working directory
WORK_DIR="./grovs"
print_info "Creating working directory: $WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Create Terraform configuration
print_info "Creating Terraform configuration..."
cat > grovs_android_publish_generated.tf <<EOF
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

provider "google" {
  project = var.project_id
  region  = "us-central1"
}

# Enable required APIs
resource "google_project_service" "enabled_services" {
  for_each = toset([
    "androidpublisher.googleapis.com"
  ])
  project = var.project_id
  service = each.value
}

# Create service account
resource "google_service_account" "play_api" {
  project      = var.project_id
  account_id   = "grovs-play-api-service-account"
  display_name = "Service Account for Google Play API Integration"
}

# Generate a key
resource "google_service_account_key" "play_api_key" {
  service_account_id = google_service_account.play_api.name
}

# Create Pub/Sub topic
resource "google_pubsub_topic" "play_notifications" {
  project = var.project_id
  name    = "grovs-play-rtdn-topic"
}

# Grant Google Play's system account permission to publish to the topic
resource "google_pubsub_topic_iam_member" "play_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.play_notifications.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:google-play-developer-notifications@system.gserviceaccount.com"
}

# Create subscription that pushes to your endpoint
resource "google_pubsub_subscription" "play_subscription" {
  project = var.project_id
  name    = "play-rtdn-subscription"
  topic   = google_pubsub_topic.play_notifications.name

  push_config {
    push_endpoint = "https://api.appss.ro/api/v1/iap/google/kL1sRa"
    oidc_token {
      service_account_email = google_service_account.play_api.email
    }
  }
}

# Grant your service account subscriber permissions
resource "google_pubsub_subscription_iam_member" "subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.play_subscription.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:\${google_service_account.play_api.email}"
}

output "service_account_email" {
  value       = google_service_account.play_api.email
  description = "Service account email for Google Play API integration"
}

output "project_id" {
  value       = var.project_id
  description = "GCP Project ID where resources were created"
}

output "service_account_private_key_json" {
  value       = base64decode(google_service_account_key.play_api_key.private_key)
  sensitive   = true
  description = "Service account private key in JSON format (base64 decoded)"
}

output "pubsub_topic_name" {
  value       = google_pubsub_topic.play_notifications.name
  description = "Pub/Sub topic name for Google Play notifications"
}

output "pubsub_topic_full_name" {
  value       = "projects/\${var.project_id}/topics/\${google_pubsub_topic.play_notifications.name}"
  description = "Full Pub/Sub topic name for Google Play Console"
}
EOF

# Configure gcloud
print_info "Configuring gcloud..."
gcloud config set project $TF_VAR_project_id

# Enable required APIs
print_info "Enabling required Google Cloud APIs..."
gcloud services enable cloudresourcemanager.googleapis.com --project=$TF_VAR_project_id
gcloud services enable iam.googleapis.com --project=$TF_VAR_project_id
gcloud services enable pubsub.googleapis.com --project=$TF_VAR_project_id

# Wait for API to propagate
print_warning "Waiting 30 seconds for APIs to propagate..."
sleep 30

# Initialize Terraform
print_info "Initializing Terraform..."
terraform init

# Run Terraform apply
print_info "Running Terraform apply..."
terraform apply -auto-approve

# Save private key
print_info "Saving private key to play-api-key.json..."
terraform output -raw service_account_private_key_json > play-api-key.json

# Download file if in Cloud Shell
if [ -n "$CLOUD_SHELL" ]; then
    print_info "Downloading key file from Cloud Shell..."
    cloudshell download play-api-key.json
    
    print_warning "Please download the file when prompted by your browser."
    read -p "Press ENTER after you've downloaded the file (or press Ctrl+C to cancel)..."
    
    print_warning "Deleting key from Cloud Shell for security..."
    rm play-api-key.json
else
    print_info "Key saved to ./grovs/play-api-key.json"
    print_warning "Remember to secure this file - it contains sensitive credentials!"
fi

echo ""
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        Google Cloud Account Setup for Grovs Complete           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Summary
print_info "Summary:"
echo "  📋 Project: $(terraform output -raw project_id)"
echo "  📧 Service Account: $(terraform output -raw service_account_email)"
echo "  📢 Pub/Sub Topic: $(terraform output -raw pubsub_topic_name)"
echo ""

# Display next steps
print_info "📝 Next Steps:"
echo "  1.Upload the downloaded json key file to Grovs:"
echo "      - Go to Grovs Dashboard > Developer > Android Setup"
echo "      - Navigate to Google Play Real-Time Developer Notifications"
echo "      - Upload the key file"
echo ""
echo "  2.Configure Google Play Console:"
echo "      - Go to your app in Play Console"
echo "      - Navigate to Monetization setup > Real-time developer notifications"
echo "      - Enter topic name: $(terraform output -raw pubsub_topic_full_name)"
echo ""
echo "  3.Link the service account in Google Play Console:"
echo "      - Go to User and permissions"
echo "      - Invite the service account: $(terraform output -raw service_account_email)"
echo "      - Grant necessary permissions:"
echo "        • View app information (read-only)"
echo "        • View financial data"
echo "        • Manage orders and subscriptions"
echo ""

# Cleanup generated terraform file (optional)
# Uncomment if you want to remove the generated .tf file after execution
# rm grovs_android_publish_generated.tf