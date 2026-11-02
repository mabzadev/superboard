export class EmDashDatabaseError extends Error {
	constructor(
		message: string,
		public override cause?: unknown,
	) {
		super(message);
		this.name = "EmDashDatabaseError";
	}
}
