---
id: TASK:tasks/daedal-dsh-client-create-profile
type: task
status: accepted
summary: "Preserve the selected Host profile through shared Client Session creation."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: ["TASK:tasks/daedal-dsh-workspace-source-sync"]
---

# Shared Client creation profile

## Plan

Use the existing SessionCreateRequest in the shared Client facade, service and manager. Forward an explicitly selected agentPreset unchanged alongside the caller-owned Session identity and chosen workspace or directory. Omission retains the Host default. Keep preset validation, creation, adoption and durable profile ownership at the existing Host controller; do not add a second mutation path, fallback profile or automatic resend.

## Acceptance

Client regressions exercise workspace and directory selection, explicit profile propagation and a rejected removed profile without a default retry. Existing creation, adoption and failure behavior stays covered. A built shared Client creates a Session through the real Host with the selected profile, reads the durable profile, and refuses a missing profile. Qualify types, lint, documentation and the existing profile recorded scenario. Native catalogs, creation UI, uncertain-operation reconciliation and release acceptance remain Phase 4 work.

## Sources

- [Client creation facade](spec:src:packages/api/session-controller/src/client/contract/sessions.ts)
- [Client service](spec:src:packages/api/session-controller/src/client/sessions/service.ts)
- [Client manager](spec:src:packages/api/session-controller/src/client/sessions/manager.ts)
- [Host creation](spec:src:packages/api/session-controller/src/commands.ts)

## Qualification

The three new Client regressions first failed with the selected profile missing from the Host request. The four creation, manager and preset owners then passed 123 cases. The compiled portable API under plain Node created real isolated Host Sessions with `minimal` through a directory and `standard` through a Workspace, and both profiles survived in their durable headers. Explicit same-id adoption retained the Session; conflicting-profile adoption and a missing profile failed. A missing profile sent one request and created no default-profile fallback or Client list entry.

The two existing Web profile scenarios pass five cases. The minimal replay supplies the model metadata recorded by its committed Session and requests deferred tool output through the visible Load full result action. Its Session recording and expected UI remain unchanged. Client build, Client types, lint and documentation checks pass. Evidence is `.dev/daedal-dsh-plan-audit/native-create-profile-20260921/verification.json`. This qualifies the shared creation owner; no native creation controls, new installed portable archive, source publication, deployment or app delivery is established here.
