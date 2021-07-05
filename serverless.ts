import type { AWS } from "@serverless/typescript";

const serverlessConfiguration: AWS = {
  service: "inverse-data",
  frameworkVersion: "2",
  custom: {
    webpack: {
      webpackConfig: "./webpack.config.js",
      includeModules: true,
    },
  },
  plugins: ["serverless-webpack"],
  provider: {
    name: "aws",
    runtime: "nodejs14.x",
    timeout: 30,
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
    },
    lambdaHashingVersion: "20201221",
  },
  functions: {
    delegates: {
      handler: "jobs/delegates.handler",
      events: [
        {
          schedule: "rate(1 hour)",
        },
      ],
    },
    proposals: {
      handler: "jobs/proposals.handler",
      events: [
        {
          schedule: "rate(1 hour)",
        },
      ],
    },
  },
};

module.exports = serverlessConfiguration;
