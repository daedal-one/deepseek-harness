---
name: deploy
description: Prepare and deploy a committed DeepSeek Harness revision through its configured operator-owned controller after explicit approval.
---

# Deploy DeepSeek Harness

Use [dsh-deploy-live-harness](../dsh-deploy-live-harness/SKILL.md) for the deployment workflow. Load it before host work. Deploy an immutable committed candidate; preserve unrelated work and never replace individual files inside an active release.

Read the deployment definition path supplied by the task or host instructions. Carry that exact path into any confirmed host handoff. If the definition names an independent controller, the maintenance conversation may share the maintained service: submit the operation, report its identity, and finish the turn before activation waits for an idle host. The controller owns restart, verification, and recovery after the conversation disconnects.

Prepare and qualify first. Present the exact candidate revision and qualification digest for approval. Submit only that approved digest; inspect durable status after cancellation, timeout, or disconnection instead of replaying activation. A qualified candidate is not a deployed release.
