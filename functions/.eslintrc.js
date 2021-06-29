module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    "ecmaVersion": 2018
  },
  extends: ["eslint:recommended", "prettier"],
  rules: {
    quotes: ["error", "double"],
  },
};
