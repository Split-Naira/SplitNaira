# Backend Route Testing Contributor Guide

This guide establishes the standards and procedures for contributing route and controller tests to the SplitNaira backend workspace (`apps/api` or `backend`).

## Testing Stack & Tools
* **Test Runner & Framework:** Jest configured with NestJS testing utilities (`@nestjs/testing`).
* **HTTP Assertions:** Supertest for integration testing of HTTP REST endpoints.
* **Mocking:** Jest mock functions and providers for service layer isolation.

## Writing Route Integration Tests

Place controller and route test files adjacent to their corresponding modules using the `.e2e-spec.ts` or `.spec.ts` naming convention:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('SplitsController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/splits (POST) - creates a new split successfully', () => {
    return request(app.getHttpServer())
      .post('/splits')
      .send({ title: 'Dinner Split', totalAmount: 12000 })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.title).toEqual('Dinner Split');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});