/** Synthetic credentials: every one must disappear from returned text. */
export const CREDENTIAL_FIXTURES: readonly { text: string; secret: string }[] =
	[
		{ text: "export DB_PASSWORD=hunter2hunter2", secret: "hunter2hunter2" },
		{ text: '{"password": "s3cr3t-value!"}', secret: "s3cr3t-value!" },
		{ text: "password: correcthorse", secret: "correcthorse" },
		{ text: "passwd=abcdef123", secret: "abcdef123" },
		{
			text: 'echo "{\\"db_password\\":\\"esc4ped-pass\\"}"',
			secret: "esc4ped-pass",
		},
		{ text: 'pwd = "qwerty123456"', secret: "qwerty123456" },
		{ text: "secret: s3cretvalue9", secret: "s3cretvalue9" },
		{ text: "token=tok_9a8b7c6d5e", secret: "tok_9a8b7c6d5e" },
		{ text: "api_key=ZZZ1234567890", secret: "ZZZ1234567890" },
		{ text: 'apikey: "abcdef0123"', secret: "abcdef0123" },
		{ text: "access_key = AKQWxxxxxx1234", secret: "AKQWxxxxxx1234" },
		{ text: "client_secret: cs_live_998877", secret: "cs_live_998877" },
		{ text: "MY_SERVICE_TOKEN=svc-55aa66bb", secret: "svc-55aa66bb" },
		{ text: "INTERNAL_KEY=kkkkkkkk9999", secret: "kkkkkkkk9999" },
		{ text: "ADMIN_SECRET='zz-top-secret-1'", secret: "zz-top-secret-1" },
		{ text: "curl --token abcdef12345 https://x.dev", secret: "abcdef12345" },
		{ text: "mysql --password=pa55word99", secret: "pa55word99" },
		{
			text: "psql postgres://admin:Sup3rS3cret@db.example.com:5432/app",
			secret: "Sup3rS3cret",
		},
		{
			text: "Authorization: Bearer abc.def-ghi_123456",
			secret: "abc.def-ghi_123456",
		},
		{
			text: "Authorization: Basic dXNlcjpwYXNzd29yZA==",
			secret: "dXNlcjpwYXNzd29yZA==",
		},
		{
			text: `token ghp_${"A1b2".repeat(9)}`,
			secret: `ghp_${"A1b2".repeat(9)}`,
		},
		{
			text: "AWS key AKIAIOSFODNN7ABCDEFG in a log",
			secret: "AKIAIOSFODNN7ABCDEFG",
		},
	];
