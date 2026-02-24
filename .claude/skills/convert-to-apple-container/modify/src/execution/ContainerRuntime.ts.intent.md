# Intent: src/execution/ContainerRuntime.ts modifications

## What changed
Replaced `DockerRuntime` class with `AppleContainerRuntime` class implementing the same `IContainerRuntime` interface. The interface is unchanged; only the concrete implementation differs.

## Key sections

### IContainerRuntime interface
- Unchanged: same six members (`bin`, `readonlyMountArgs`, `readwriteMountArgs`, `stopContainer`, `ensureRunning`, `cleanupOrphans`)

### AppleContainerRuntime class (replaces DockerRuntime)
- `bin`: returns `'container'` instead of `'docker'`
- `readonlyMountArgs`: Docker `-v host:container:ro` replaced with Apple Container `--mount type=bind,source=...,target=...,readonly`
- `readwriteMountArgs`: unchanged (`-v host:container` works for both runtimes)
- `stopContainer`: unchanged pattern (`<bin> stop <name>`)
- `ensureRunning`: `docker info` replaced with `container system status`, added auto-start via `container system start`
- `cleanupOrphans`: `docker ps --filter` replaced with `container ls --format json` using JSON parsing (`{ status, configuration: { id } }` structure)

### Backward-compatible alias
- `AppleContainerRuntime` re-exported as `DockerRuntime` so existing consumers don't need import changes

## Invariants
- `IContainerRuntime` interface signature is identical to the Docker version
- All six interface methods are implemented
- Logger usage pattern is unchanged
- Error handling pattern (box-drawing FATAL output) is unchanged
- The class is instantiated elsewhere (not a singleton in this file)

## Must-keep
- The `IContainerRuntime` interface (consumed by ContainerRunner.ts and other modules)
- The `DockerRuntime` export alias (backward compatibility)
- The error box-drawing output format
- The orphan cleanup logic (find + stop pattern)
