module.exports = {
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint/eslint-plugin', 'import'],
    parserOptions: {
        project: './tsconfig.eslint.json',
        sourceType: 'module',
    },
    extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
    root: true,
    env: {
        node: true,
    },
    ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
    rules: {
        'max-len': [
            'error',
            150,
            {
                ignorePattern: '^import\\s.+\\sfrom\\s.+;$',
                ignoreUrls: true,
            },
        ],
        'import/no-duplicates': 'warn',
        'import/order': [
            'warn',
            {
                'newlines-between': 'always',
                groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
                alphabetize: {
                    order: 'asc',
                    caseInsensitive: true,
                },
            },
        ],
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/array-type': ['error', { default: 'generic' }],
        '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/no-unused-vars': [
            'error',
            {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            },
        ],
        'no-console': 'error',
        'no-empty': 'error',
        'no-restricted-syntax': [
            'error',
            {
                // Ban optional properties in interfaces and type aliases.
                // Use explicit `field: T | null` instead of `field?: T`.
                // Does not affect function parameters — those are still allowed to be optional.
                selector: 'TSPropertySignature[optional=true]',
                message:
                    'Use explicit nullable fields (`field: T | null`) instead of optional properties (`field?: T`). See CLAUDE.md > Code Style > Nullable Fields.',
            },
        ],
        'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
};
