import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'public/vendor/**', 'drizzle/**', 'data/raw/**', 'playwright-report/**', 'test-results/**'] },
  {
    // 1.1.4.2: `cond && x` as a value of a translated text shows "false" when the condition is false
    // (the "false632 км с товар" bug). Use a ternary with '' instead.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name=/^(t|tr|tx)$/] > LogicalExpression[operator='&&']",
          message: 'A `cond && …` value in t()/tr() shows "false" when cond is false — use `cond ? … : \'\'`.',
        },
      ],
    },
  },
];

export default config;
