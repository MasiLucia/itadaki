/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/libs', '<rootDir>/apps'],
  moduleNameMapper: {
    '^@itadaki/analytics/domain$': '<rootDir>/libs/analytics/domain/src/index.ts',
    '^@itadaki/shared/persistence$': '<rootDir>/libs/shared/persistence/src/index.ts',
    '^@itadaki/identity/infra$': '<rootDir>/libs/identity/infra/src/index.ts',
    '^@itadaki/identity/application$': '<rootDir>/libs/identity/application/src/index.ts',
    '^@itadaki/identity/domain$': '<rootDir>/libs/identity/domain/src/index.ts',
    '^@itadaki/shared/domain$': '<rootDir>/libs/shared/domain/src/index.ts',
    '^@itadaki/shared/offline$': '<rootDir>/libs/shared/offline/src/index.ts',
    '^@itadaki/shared/i18n$': '<rootDir>/libs/shared/i18n/src/index.ts',
    '^@itadaki/catalog/domain$': '<rootDir>/libs/catalog/domain/src/index.ts',
    '^@itadaki/catalog/application$': '<rootDir>/libs/catalog/application/src/index.ts',
    '^@itadaki/ordering/domain$': '<rootDir>/libs/ordering/domain/src/index.ts',
    '^@itadaki/ordering/application$': '<rootDir>/libs/ordering/application/src/index.ts',
    '^@itadaki/ordering/infra$': '<rootDir>/libs/ordering/infra/src/index.ts',
    '^@itadaki/billing/domain$': '<rootDir>/libs/billing/domain/src/index.ts',
    '^@itadaki/billing/application$': '<rootDir>/libs/billing/application/src/index.ts',
    '^@itadaki/billing/infra$': '<rootDir>/libs/billing/infra/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }],
  },
};
