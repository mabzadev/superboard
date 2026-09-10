export function checksDirectory(project: string): string;
export function prepareTestDependencies(): void;
export function centralTests<T>(origin: string | URL, configuration: T): T;
