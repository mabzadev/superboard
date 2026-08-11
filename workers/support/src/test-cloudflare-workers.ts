export class DurableObject<WorkerEnv> {
  constructor(protected readonly ctx: DurableObjectState, protected readonly env: WorkerEnv) {}
}
