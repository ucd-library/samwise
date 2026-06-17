# Samwise

**A private, on-premises AI assistant platform for UC Davis Library staff.**

---

## What Is Samwise?

Samwise is the UC Davis Library's internally hosted artificial intelligence platform. It gives Library staff access to large language models (LLMs) — the same class of technology powering tools like ChatGPT — without sending any data to external companies. All conversations, queries, and documents shared with the system remain entirely within Library and UC Davis infrastructure.

The platform is built on open-source AI models and self-hosted infrastructure. This means the Library controls what models run, who can access them, how usage is tracked, and what data is retained — with no per-query licensing fees and no dependency on third-party AI providers. The ongoing cost is the electricity and hardware already allocated to the Library's server infrastructure.

Today, Samwise supports conversational AI assistance and text embeddings (a building block for search and document intelligence). Beyond text conversation, the platform supports image and document analysis, and has been validated as a backend for autonomous AI agents — enabling workflows where the AI iterates through multi-step tasks without continuous human prompting. It is designed to grow: additional models, document ingestion, and application-specific AI tools can be added as Library needs evolve.

---

## Who Uses It and How

Samwise is available to all Library staff on the UC Davis network or VPN. There is no separate account to create — staff log in with their existing UC Davis credentials through the standard UC Davis authentication system (CAS).

**Accessing Samwise:** Open a browser and go to `samwise.library.ucdavis.edu`. The interface is a familiar chat-style application similar to ChatGPT or Claude.

**Currently Available Models**

| Model | Best For |
|---|---|
| `qwen3.5-fast:35b` | Quick questions, drafting, summarization — fastest response |
| `qwen3.5-thinking:35b` | Complex reasoning, analysis, multi-step problems — slower but more thorough |
| `qwen3.6-fast:35b` | Same as above with a newer model generation; supports very long documents (131k context) |
| `qwen3.6-thinking:35b` | Deep reasoning with extended context — best for research-grade tasks |
| `qwen3-embed:8b` | Embedding API for developers building search or semantic similarity features |

All models support **tool/function calling**, enabling AI agents that can invoke external systems as part of a workflow.

**For Developers:** Open-WebUI exposes an OpenAI-compatible API at `samwise.library.ucdavis.edu/api`. Any code written against the OpenAI API can point at Samwise instead with only a base URL and key change.

---

## System Architecture

Samwise is composed of four services that work in a layered stack:

| Layer | Component | Role |
|---|---|---|
| UI | **Open-WebUI** | Chat interface served to staff browsers. Handles authentication, conversation history, and user settings. Runs as 8 replicas for availability. |
| Gateway | **LiteLLM** | OpenAI-compatible API proxy. Routes requests to the correct model backend, enforces API keys, tracks per-user usage, and stores configuration in the database. |
| Inference | **vLLM** | Runs the actual AI models on GPU hardware. Each model deployment is pinned to a specific physical node via Kubernetes node selectors. |
| Persistence | **PostgreSQL** | Stores conversation history, user data, LiteLLM configuration, and usage logs. |

**Authentication flow:** Staff arrive at Open-WebUI, are redirected to UC Davis CAS (Keycloak at `auth.library.ucdavis.edu`), authenticate with their UCD credentials, and are returned with a session token. Password authentication is disabled — only institutional SSO is permitted. The user's email is forwarded to LiteLLM via a header so usage can be tracked per individual without storing credentials.

**Secrets and configuration** are managed through Google Cloud Secret Manager and applied to the cluster at deploy time via `cork-kube`. TLS certificates are provisioned for both public-facing endpoints.

**Access is VPN-scoped:** The Kubernetes ingress class is `vpn-ingress`, meaning both the web UI and API are only reachable from the UC Davis network or VPN.

---

## Infrastructure Diagrams

### System Topology

```mermaid
graph TD
  Staff["Library Staff\n(Browser)"] -->|HTTPS / VPN only| OWUI_Ingress["nginx Ingress\nsamwise.library.ucdavis.edu"]
  DevClient["Developer\nAPI Client"] -->|Bearer Token / VPN| LiteLLM_Ingress["nginx Ingress\nsamwise-api.library.ucdavis.edu"]

  OWUI_Ingress --> OpenWebUI["Open-WebUI\n(8 replicas)"]
  LiteLLM_Ingress --> LiteLLM

  OpenWebUI -->|OIDC redirect| CAS["UC Davis CAS\nauth.library.ucdavis.edu"]
  OpenWebUI -->|Chat API calls| LiteLLM["LiteLLM\nAPI Gateway"]
  OpenWebUI --- PG[("PostgreSQL\nConversations & Users")]
  LiteLLM --- PG

  LiteLLM -->|OpenAI-compatible| C1_Q36["vLLM — cyberdyne01\nQwen3.6-35B-A3B\nport 8000"]
  LiteLLM -->|OpenAI-compatible| C2_Q35["vLLM — cyberdyne02\nQwen3.5-35B-A3B\nport 8000"]
  LiteLLM -->|Embedding API| C2_EMB["vLLM — cyberdyne02\nQwen3-Embedding-8B\nport 8001"]
```

---

### Request Flow

```mermaid
sequenceDiagram
  actor Staff as Library Staff
  participant UI as Open-WebUI
  participant CAS as UC Davis CAS
  participant LLM as LiteLLM
  participant GPU as vLLM (GPU Node)
  participant DB as PostgreSQL

  Staff->>UI: Visit samwise.library.ucdavis.edu
  UI->>CAS: Redirect — OIDC login
  CAS-->>UI: Token (email, groups)
  UI-->>Staff: Chat interface ready

  Staff->>UI: Send message
  UI->>LLM: POST /v1/chat/completions\n+ X-OpenWebUI-User-Email header
  LLM->>DB: Log request, look up model route
  LLM->>GPU: Forward prompt to selected model
  GPU-->>LLM: Stream tokens
  LLM-->>UI: Stream response
  UI-->>Staff: Response rendered in chat
```

---

### GPU Node Layout

```mermaid
graph LR
  LiteLLM["LiteLLM\nAPI Gateway"]

  subgraph cy01["cyberdyne01.library.ucdavis.edu"]
    direction TB
    Q36F["qwen3.6-fast:35b\nQwen3.6-35B-A3B\n131k token context\nhermes tool parser"]
    Q36T["qwen3.6-thinking:35b\nSame model\nchain-of-thought mode enabled"]
  end

  subgraph cy02["cyberdyne02.library.ucdavis.edu"]
    direction TB
    Q35F["qwen3.5-fast:35b\nQwen3.5-35B-A3B\n16k token context\nhermes tool parser"]
    Q35T["qwen3.5-thinking:35b\nSame model\nchain-of-thought mode enabled"]
    QEB["qwen3-embed:8b\nQwen3-Embedding-8B\n8k token context\nport 8001"]
  end

  LiteLLM -->|routes by model name| cy01
  LiteLLM -->|routes by model name| cy02
```

---

### Deployment Stack

```mermaid
graph TD
  subgraph k8s["Kubernetes Cluster — microk8s / UC Davis Library"]
    OWUI["Open-WebUI\n(Deployment, 8 replicas)"]
    LiteLLM["LiteLLM\n(Deployment)"]
    PG["PostgreSQL\n(StatefulSet, 25Gi)"]
    Ingress["nginx Ingress\n(vpn-ingress class)"]
  end

  subgraph gpu_nodes["Bare-Metal GPU Nodes (Kubernetes workers)"]
    C1["cyberdyne01\nvLLM Qwen3.6"]
    C2["cyberdyne02\nvLLM Qwen3.5 + Embedding"]
  end

  subgraph secrets["Secrets & Config"]
    GCSM["Google Cloud\nSecret Manager"]
    Cork["cork-kube\ndeploy tooling"]
  end

  Cork -->|apply secrets + kustomize| k8s
  Cork -->|apply vllm overlays| gpu_nodes
  GCSM -->|TLS certs, master keys, OAuth secrets| Cork
  Ingress --> OWUI
  Ingress --> LiteLLM
  LiteLLM --> PG
  OWUI --> PG
  LiteLLM --> C1
  LiteLLM --> C2
```
