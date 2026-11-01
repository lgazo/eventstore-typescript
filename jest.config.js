module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    'packages/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/**/__tests__/**/*.ts',
    '!packages/**/__tests__/**/*.ts',
    '!packages/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: [],
  moduleNameMapper: {
    '^@lgazo/eventstore$': '<rootDir>/src/index.ts',
    '^@lgazo/eventstore/(.*)$': '<rootDir>/src/$1',
    '^@lgazo/eventstore-postgres$': '<rootDir>/packages/postgres/src/index.ts',
    '^@lgazo/eventstore-postgres/(.*)$': '<rootDir>/packages/postgres/src/$1',
    '^@lgazo/eventstore-supabase$': '<rootDir>/packages/supabase/src/index.ts',
    '^@lgazo/eventstore-supabase/(.*)$': '<rootDir>/packages/supabase/src/$1',
    '^@lgazo/eventstore-d1$': '<rootDir>/packages/d1/src/index.ts',
    '^@lgazo/eventstore-d1/(.*)$': '<rootDir>/packages/d1/src/$1'
  }
};
