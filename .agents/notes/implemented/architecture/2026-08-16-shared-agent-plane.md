# Agent Note: Shared agent plane for every preset-aware surface

Status: implemented

English | [中文](2026-08-16-shared-agent-plane.zh.md)

## Problem

The web profile owned the host rows disabled by per-session preset composition, while the headless profile still executed the base bundle's model-facing Consumers directly. A preset therefore described a complete Agent only on the web surface. The same preset selected through headless could receive a different prompt, tool registry, compaction behavior, and delegation surface.

## Decision

`dsh-agent-plane` is a required bundle layer between `dsh-base` and every preset-aware surface. It disables the base model-facing rows that a preset replaces and mounts the preset roster. Surface bundles contain only their transport or application behavior.

Agent creation uses one composition helper owned by `dsh-agent-presets`. The helper resolves the selected or default preset, writes it to the Session header before the Agent is published, and mounts the preset during the Agent factory's setup window. Web `ApiProxy` and the headless runner call that helper rather than reconstructing the sequence.

## Alternatives considered

**Keep composition in each surface bundle.** Rejected because every new surface could silently diverge and the profile manifests would not reveal one common ownership point.

**Move all Agent Consumers into the base bundle.** Rejected because process-global Consumers cannot represent per-session preset selection or isolate two preset registries.

## Consequences

One preset now has the same model-facing composition on web and headless surfaces. Profile manifests declare the shared layer explicitly, so configuration dumps and installation fallback resolution show the real order. A custom surface that wants preset selection must include the agent-plane bundle and use the shared composition helper; omitting either is an incomplete surface, not an alternative preset runtime.

The agent-plane bundle does not choose a persona, model, or tool set. Those remain preset data. Surface-specific host services remain outside the preset and can still differ by deployment.

Headless disables source-module HMR but retains live profile and home patch files. Its launcher fallback polls those two exact configuration paths; native directory watchers can exceed the low per-process file-descriptor limit on macOS before a one-shot task starts.
