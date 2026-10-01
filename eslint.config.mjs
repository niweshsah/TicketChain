import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts', 'apps/api/scripts/**/*.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  ...['identity', 'booking', 'payments', 'catalog'].map((service) => ({
    files: [`apps/api/src/services/${service}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['identity', 'booking', 'payments', 'catalog']
            .filter((other) => other !== service)
            .map((other) => ({
              group: [`**/${other}/**`, `**/${other}`],
              message:
                'Use service HTTP or message contracts; direct calls belong only in the standalone adapter.',
            })),
        },
      ],
    },
  })),
);
