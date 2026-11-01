"use client";

import {
	CodeBlock,
	CodeBlockBody,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockFilename,
	CodeBlockFiles,
	CodeBlockHeader,
	CodeBlockItem,
} from "@superboard/front-ui/ui/shadcn-io/code-block/index.js";
import type { BundledTheme } from "shiki";

import type { CodeBlockData } from "./SetupShared.js";

export default function RenderCodeBlock({ data }: { data: CodeBlockData[] }) {
	return (
		<CodeBlock data={data} defaultValue={data[0]?.language ?? ""}>
			<CodeBlockHeader>
				<CodeBlockFiles>
					{(item) => (
						<CodeBlockFilename key={item.language} value={item.language}>
							{item.filename}
						</CodeBlockFilename>
					)}
				</CodeBlockFiles>
				<CodeBlockCopyButton onCopy={() => {}} onError={() => {}} />
			</CodeBlockHeader>
			<CodeBlockBody>
				{(item) => (
					<CodeBlockItem key={item.language} value={item.language}>
						<CodeBlockContent
							syntaxHighlighting
							themes={
								{ light: "github-light", dark: "github-dark" } satisfies Record<
									string,
									BundledTheme
								>
							}
							language={item.language}
						>
							{item.code}
						</CodeBlockContent>
					</CodeBlockItem>
				)}
			</CodeBlockBody>
		</CodeBlock>
	);
}
