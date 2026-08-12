#!/usr/bin/env bash
# Build the production API image, load it into kind, and apply the kind overlay.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-cip}"
IMAGE="cip-api:kind"

cd "$ROOT"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is not installed. See https://kind.sigs.k8s.io/" >&2
  exit 1
fi

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "kind cluster '$CLUSTER_NAME' not found. Create it first:" >&2
  echo "  kind create cluster --name $CLUSTER_NAME" >&2
  exit 1
fi

if ! kubectl get secret cip-api-secrets -n cip >/dev/null 2>&1; then
  echo "Secret cip-api-secrets missing in namespace cip." >&2
  echo "  cp deploy/k8s/base/secret.yaml.example deploy/k8s/base/secret.yaml" >&2
  echo "  # fill values, then:" >&2
  echo "  kubectl apply -f deploy/k8s/base/secret.yaml" >&2
  exit 1
fi

echo "Building $IMAGE (production target)…"
docker build -f apps/api/Dockerfile --target production -t "$IMAGE" .

echo "Loading image into kind cluster '$CLUSTER_NAME'…"
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"

echo "Applying Kustomize overlay overlays/kind…"
kubectl apply -k deploy/k8s/overlays/kind

echo "Waiting for rollout…"
kubectl -n cip rollout status deployment/cip-api --timeout=180s

echo
echo "Smoke test (port-forward in another terminal):"
echo "  kubectl -n cip port-forward svc/cip-api 4000:80"
echo "  curl -s http://127.0.0.1:4000/health"
echo "  curl -s http://127.0.0.1:4000/api/health"
