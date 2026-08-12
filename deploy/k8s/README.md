# Kubernetes — API only

Web stays on **Vercel**. Data stays **managed** (Atlas, Elastic Cloud, Upstash). This folder deploys the Express API (with in-process BullMQ workers) to Kubernetes.

```
Browser → Vercel (web) → K8s cip-api → Atlas / Elastic Cloud / Upstash
```

---

## Cursor vs manual

### Done in-repo (Cursor)

- Production Docker stages (`apps/api/Dockerfile`, `apps/web/Dockerfile`)
- `PORT` then `API_PORT` listen config
- Kustomize base + `overlays/kind`
- This README + `scripts/kind-up.sh`
- CI image build/push to GHCR on `main`
- `pnpm --filter @content-insights/api reindex-es` script

### You do manually

1. Install Docker, `kubectl`, `kind`
2. Create a kind cluster (+ ingress-nginx)
3. Copy `base/secret.yaml.example` → `base/secret.yaml`, fill from `.env.prod`, apply it (never commit)
4. Build/load the API image and `kubectl apply -k overlays/kind`
5. Smoke-test `/health` and `/api/health`
6. When ready: provision GKE/EKS/AKS, apply base (with real image + host), TLS optional
7. Cut over: set Vercel `VITE_API_URL` to the new API `/api`, redeploy web, then stop Render

---

## Prerequisites

- Docker Desktop (or Engine)
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Local kind bring-up

### 1. Cluster + ingress

```bash
kind create cluster --name cip

# ingress-nginx for kind
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=120s
```

### 2. Secrets (never commit)

```bash
cp deploy/k8s/base/secret.yaml.example deploy/k8s/base/secret.yaml
# Edit secret.yaml with Atlas / Elastic / Upstash / JWT values from .env.prod
kubectl apply -f deploy/k8s/base/secret.yaml
```

Confirm `CORS_ORIGIN` in [`base/configmap.yaml`](base/configmap.yaml) matches your Vercel origin (no trailing slash).

### 3. Build image and load into kind

From the **repo root** (Linux/macOS/Git Bash):

```bash
./deploy/k8s/scripts/kind-up.sh
```

Or manually:

```bash
docker build -f apps/api/Dockerfile --target production -t cip-api:kind .
kind load docker-image cip-api:kind --name cip
kubectl apply -k deploy/k8s/overlays/kind
kubectl -n cip rollout status deployment/cip-api --timeout=180s
```

### 4. Smoke test

**Port-forward (simplest):**

```bash
kubectl -n cip port-forward svc/cip-api 4000:80
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4000/api/health
```

Expect mongo / elasticsearch / redis `"ok"`.

**Ingress host:** map `cip-api.localhost` to the kind node IP (or use `127.0.0.1` with kind's port mappings if configured). Prefer port-forward for the first smoke test.

### 5. Reindex Elastic (only if Articles are empty)

If Mongo has data but Elastic Cloud is empty:

```bash
# from repo root, with prod env
DOTENV_CONFIG_PATH=.env.prod pnpm --filter @content-insights/api reindex-es
```

---

## Apply on a real cluster

1. Push images via CI (`ghcr.io/<github-owner>/cip-api:<sha>` and `:main`)
2. Patch the Deployment image (or add a `overlays/prod` with your registry + host)
3. Apply secrets and `kubectl apply -k deploy/k8s/base`
4. Point DNS at the Ingress LB; add cert-manager TLS when ready
5. Cut over Vercel `VITE_API_URL` → `https://<your-api-host>/api` and redeploy
6. Decommission Render after login + Articles work

---

## Layout

| Path | Purpose |
|------|---------|
| `base/` | Namespace, ConfigMap, Deployment, Service, Ingress |
| `base/secret.yaml.example` | Template only |
| `overlays/kind/` | Local image `cip-api:kind`, host `cip-api.localhost`, `imagePullPolicy: Never` |
| `scripts/kind-up.sh` | Build, load, apply kind overlay |

---

## Out of scope (this phase)

- Web Deployment on K8s (Vercel stays)
- Mongo / ES / Redis in-cluster
- Split worker Deployments
- Multi-replica uploads (needs object storage)
- Auto-deploy from CI to a cloud cluster
