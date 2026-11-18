import { describe, expect, test } from "bun:test";
import {
	signDownloadUrl,
	signPartUploadUrl,
	verifyDownloadUrl,
	verifyPartUploadUrl,
} from "./local-object-store-url.js";

const signing = {
	publicOrigin: "http://192.168.2.74:4791",
	signingSecret: "signing-secret-0123456789abcdef0123",
};
const part = {
	byteLength: 8_388_608,
	expiresAt: 1_800_000_000,
	partNumber: 2,
	uploadId: "0123456789abcdef0123456789abcdef",
};
const download = {
	cacheControl: "private, max-age=300",
	contentDisposition: 'inline; filename="abc.png"',
	contentType: "image/png",
	expiresAt: 1_800_000_000,
	objectKey: "evidence/v2/org/ab/abcd/uuid",
};

describe("part upload URLs", () => {
	test("verify only with the same secret, before expiry", () => {
		const url = new URL(signPartUploadUrl(signing, part));
		expect(url.origin).toBe(signing.publicOrigin);
		expect(
			verifyPartUploadUrl(url, signing.signingSecret, part.expiresAt),
		).toEqual({
			ok: true,
			value: part,
		});
		expect(
			verifyPartUploadUrl(url, "another-secret-0123456789abcdef0123", 0),
		).toMatchObject({ code: "SignatureDoesNotMatch", ok: false, status: 403 });
		expect(
			verifyPartUploadUrl(url, signing.signingSecret, part.expiresAt + 1),
		).toMatchObject({ code: "AccessDenied", ok: false, status: 403 });
	});

	test("reject every tampered field, a missing signature and malformed values", () => {
		const signed = new URL(signPartUploadUrl(signing, part));
		for (const [name, value] of [
			["upload", "fedcba9876543210fedcba9876543210"],
			["part", "3"],
			["bytes", "8388609"],
			["expires", "1900000000"],
		] as const) {
			const tampered = new URL(signed);
			tampered.searchParams.set(name, value);
			expect(
				verifyPartUploadUrl(tampered, signing.signingSecret, 0),
			).toMatchObject({
				code: "SignatureDoesNotMatch",
				status: 403,
			});
		}
		const unsigned = new URL(signed);
		unsigned.searchParams.delete("signature");
		expect(
			verifyPartUploadUrl(unsigned, signing.signingSecret, 0),
		).toMatchObject({
			code: "AccessDenied",
			status: 403,
		});
		for (const [name, value] of [
			["upload", "../../etc"],
			["part", "0"],
			["part", "10001"],
			["bytes", "-1"],
			["bytes", "1e3"],
			["expires", ""],
		] as const) {
			const malformed = new URL(signed);
			malformed.searchParams.set(name, value);
			expect(
				verifyPartUploadUrl(malformed, signing.signingSecret, 0),
			).toMatchObject({
				code: "InvalidRequest",
				status: 400,
			});
		}
	});
});

describe("download URLs", () => {
	test("pin the key, type, disposition and cache policy", () => {
		const signed = new URL(signDownloadUrl(signing, download));
		expect(verifyDownloadUrl(signed, signing.signingSecret, 0)).toEqual({
			ok: true,
			value: download,
		});
		for (const [name, value] of [
			["key", "evidence/v2/org/ab/abcd/other"],
			["type", "text/html"],
			["disposition", "inline"],
			["cache", "public, max-age=31536000"],
		] as const) {
			const tampered = new URL(signed);
			tampered.searchParams.set(name, value);
			expect(
				verifyDownloadUrl(tampered, signing.signingSecret, 0),
			).toMatchObject({
				code: "SignatureDoesNotMatch",
			});
		}
		const injected = new URL(signed);
		injected.searchParams.set("type", "image/png\r\nSet-Cookie: x=1");
		expect(verifyDownloadUrl(injected, signing.signingSecret, 0)).toMatchObject(
			{
				code: "InvalidRequest",
			},
		);
		expect(
			verifyDownloadUrl(signed, signing.signingSecret, download.expiresAt + 1),
		).toMatchObject({ code: "AccessDenied" });
	});
});
