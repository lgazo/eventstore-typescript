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
    '^@ricofritzsche/eventstore$': '<rootDir>/src/index.ts',
    '^@ricofritzsche/eventstore/(.*)$': '<rootDir>/src/$1',
    '^@ricofritzsche/eventstore-postgres$': '<rootDir>/packages/postgres/src/index.ts',
    '^@ricofritzsche/eventstore-postgres/(.*)$': '<rootDir>/packages/postgres/src/$1'
  }
};
