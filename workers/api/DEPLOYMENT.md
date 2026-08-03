# API deployment

The repository-wide deployment procedure is maintained in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

The API owns public ingress and orchestration. It does not become a second application authentication authority, and in Billing service mode it proxies financial administration and execution to the private Billing Worker.
