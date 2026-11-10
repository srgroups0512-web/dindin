module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['server/**/*.js'],
      env: {node: true, es2021: true},
    },
  ],
};
