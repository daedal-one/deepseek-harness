# Agent Note: Workspace execution admission

Status: implemented

## Problem

Reserving a physical workspace when a conversation opens exhausts bounded storage even when those conversations have no running turns. New conversation creation then fails and the selected workspace can reset.

## Decision

Physical workspace slots belong to admitted execution, not open conversations. Creating or selecting a conversation cannot consume bounded execution capacity. Turns and file operations acquire cancellation-aware FIFO admission while unrelated conversations retain separate files. Child agents use their parent's workspace.

The last workspace user waits for writers and a durable checkpoint before releasing capacity. Pending saves retain their slot and retry. Passive file observations retain conversation attribution without holding execution capacity. A later operation restores the conversation's private files; recovery checkpoints unclean slots under exclusive leases before reuse.

Durable `workspace/admission` events expose waiting before model execution. Cancelling queued work preserves workspace selection. Admission and cancellation hide the waiting node without withdrawing an already-published conversation node.

## Alternatives considered

Refusing conversation creation at capacity makes the workspace selector unusable while idle conversations retain storage. Sharing mutable checkouts would expose independent conversations to each other's writes. Execution admission preserves both selection and file isolation.

## Consequences

Queued work can wait for a background writer or failed checkpoint to settle. Cancellation removes a waiting request without releasing another conversation's files. Reusing a slot requires restoring the owner's acknowledged checkpoint before filesystem or model work resumes.

The [accepted task](../../../../.specs/tasks/workspace-execution-admission.spec.md) owns the lifecycle, queue, and browser evidence. Repository grants and deployment activation remain separate from execution capacity.
