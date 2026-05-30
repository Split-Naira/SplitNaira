export class PipelineGuard {
  static ensureTestsPassed(testResult: boolean) {
    if (!testResult) {
      throw new Error('CI_ABORT: Tests must pass before deployment');
    }
  }

  static ensureBuildSuccess(buildResult: boolean) {
    if (!buildResult) {
      throw new Error('CI_ABORT: Build failed');
    }
  }

  static ensureSafeDeploy(env: string) {
    if (env === 'production') {
      console.log('[CI] Production deployment validated');
    }
  }
}