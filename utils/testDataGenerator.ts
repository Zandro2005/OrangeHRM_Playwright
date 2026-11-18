import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { faker } from '@faker-js/faker';

export interface GeneratedEmployeeInput {
  firstName: string;
  middleName: string;
  lastName: string;
  employeeId: string;
}

export interface GeneratedEmployeeLoginInput extends GeneratedEmployeeInput {
  username: string;
  password: string;
}

export interface EmployeesTestData {
  nonExistentEmployeeId: string;
  personalDetailsUpdate: {
    middleName: string;
    licenseNumber: string;
    licenseExpiryDate: string;
    dateOfBirth: string;
  };
  contactDetailsUpdate: {
    street1: string;
    city: string;
    stateProvince: string;
    zipCode: string;
    mobile: string;
    workEmailPrefix: string;
  };
  invalidData: {
    weakPassword: string;
    mismatchedPasswordA: string;
    mismatchedPasswordB: string;
    invalidFileName: string;
    invalidFileMime: string;
    oversizedFileName: string;
    oversizedFileBytes: number;
  };
}

function sanitizeAlpha(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 12) : fallback;
}

function uniqueAlphaTag(length = 4): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => letters[b % letters.length]).join('');
}

/** Generate unique alphabetic employee data and a <=10 char Employee Id via Faker + crypto. */
export function generateEmployeeData(prefix = 'Pim'): GeneratedEmployeeInput {
  const hex = crypto.randomBytes(4).toString('hex').slice(0, 7);
  const alphaTag = uniqueAlphaTag(4);
  const first = sanitizeAlpha(faker.person.firstName(), 'Avery');
  const last = sanitizeAlpha(faker.person.lastName(), 'Morgan');

  return {
    firstName: `${sanitizeAlpha(prefix, 'Pim')}${first}${alphaTag}`.slice(0, 24),
    middleName: '',
    lastName: `${last}${alphaTag}`.slice(0, 24),
    employeeId: `P${hex}`,
  };
}

/** Generate unique employee data paired with complexity-compliant OrangeHRM login credentials. */
export function generateEmployeeWithLogin(prefix = 'Pim'): GeneratedEmployeeLoginInput {
  const base = generateEmployeeData(prefix);
  const suffix = crypto.randomBytes(3).toString('hex');

  return {
    ...base,
    username: `pim_${base.employeeId.toLowerCase()}_${suffix}`,
    password: `Emp!${suffix}9aA`,
  };
}

/** Load structured Module 3 employee validation/edit test data from test-data/employees.json. */
export function loadEmployeesTestData(): EmployeesTestData {
  const filePath = path.resolve(__dirname, '../test-data/employees.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as EmployeesTestData;
}

export interface GeneratedSystemUserCredentials {
  username: string;
  password: string;
  updatedUsername: string;
  updatedPassword: string;
}

/** Generate unique usernames and complexity-compliant passwords for Module 4 User Management tests. */
export function generateSystemUserCredentials(prefix = 'usr'): GeneratedSystemUserCredentials {
  const suffix = crypto.randomBytes(3).toString('hex');
  return {
    username: `${prefix}_${suffix}`,
    password: `Usr!${suffix}9aA`,
    updatedUsername: `${prefix}_upd_${suffix}`,
    updatedPassword: `Upd!${suffix}8bB`,
  };
}
