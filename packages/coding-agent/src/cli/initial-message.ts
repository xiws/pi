import type { ImageContent } from "@earendil-works/pi-ai";
import type { Args } from "./args.ts";

export interface InitialMessageInput {
	parsed: Args;
	fileText?: string;
	fileImages?: ImageContent[];
	stdinContent?: string;
}

export interface InitialMessageResult {
	initialMessage?: string;
	initialImages?: ImageContent[];
}

/**
 * Combine stdin content, @file text, and the first CLI message into a single
 * initial prompt for non-interactive mode.
 *
 * 中文说明：把三部分内容按顺序拼接成一条“初始 prompt”字符串：
 *   1. stdinContent —— 管道输入（如 `echo hi | pi -p`）
 *   2. fileText     —— 命令行 @file 参数的文件内容（由 processFileArguments 读入）
 *   3. parsed.messages[0] —— 第一条位置参数，即用户敲的 prompt
 * 拼接后把第一条消息从 messages 里移除（shift），剩余消息留给后续轮次发送。
 */
export function buildInitialMessage({
	parsed,
	fileText,
	fileImages,
	stdinContent,
}: InitialMessageInput): InitialMessageResult {
	// 依序把 stdin 内容、@file 文本、第一条用户消息拼接起来。
	// （parts.join("") 无分隔符直接连接；fileImages 是 @图片 参数读出的图片内容。）
	const parts: string[] = [];
	if (stdinContent !== undefined) {
		parts.push(stdinContent);
	}
	if (fileText) {
		parts.push(fileText);
	}

	if (parsed.messages.length > 0) {
		parts.push(parsed.messages[0]);
		parsed.messages.shift();
	}

	return {
		initialMessage: parts.length > 0 ? parts.join("") : undefined,
		initialImages: fileImages && fileImages.length > 0 ? fileImages : undefined,
	};
}
