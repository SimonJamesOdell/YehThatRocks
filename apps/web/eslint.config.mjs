import tsParser from "@typescript-eslint/parser";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
	{
		ignores: [
			".tmp-*.ts",
			"**/.tmp-*.ts",
			"**/node_modules/**",
			".next/**",
			"**/.next/**",
			".turbo/**",
			"**/.turbo/**",
			"dist/**",
			"build/**",
		],
	},
	{
		files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
		plugins: {
			"@next/next": nextPlugin,
			"react-hooks": reactHooksPlugin,
		},
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
	},
];
