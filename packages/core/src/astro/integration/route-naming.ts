export function routeArtifactName(srcRelativePathNoExt: string): string {
	return srcRelativePathNoExt.replaceAll("[", "_").replaceAll("]", "_");
}
