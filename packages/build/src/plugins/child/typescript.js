'use strict'

const { extname } = require('path')

const execa = require('execa')
const { register } = require('ts-node')

const { addErrorInfo } = require('../../error/info')

// Allow local plugins to be written with TypeScript.
// Local plugins cannot be transpiled by the build command since they can be run
// before it. Therefore, we type-check and transpile them automatically using
// `ts-node`.
const registerTypeScript = function (pluginPath) {
  if (!isTypeScriptPlugin(pluginPath)) {
    return
  }

  register()
}

// On TypeScript errors, adds information about the `ts-node` configuration,
// which includes the resolved `tsconfig.json`.
const addTsErrorInfo = async function (error, pluginPath) {
  if (!isTypeScriptPlugin(pluginPath)) {
    return
  }

  const { stdout } = await execa.command('ts-node --show-config', {
    // `ts-node` is located inside `@netlify/build` `node_modules` directory.
    // `preferLocal: true` ensures any parent `node_modules/.bin/` directory
    // is searched.
    // It does so starting from `localDir`, which defaults to `process.cwd()`.
    // The current directory is the plugin's main file's directory.
    // Therefore it needs to be changed to `__dirname` to be able to find
    // `ts-node` binary.
    localDir: __dirname,
    preferLocal: true,
  })
  const tsConfig = safeJsonParse(stdout)
  addErrorInfo(error, { tsConfig })
}

// The output of `ts-node --show-config` should be JSON.
// This is just a failsafe.
const safeJsonParse = function (stdout) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    return { stdout, parsingError: error.message }
  }
}

const isTypeScriptPlugin = function (pluginPath) {
  return TYPESCRIPT_EXTENSIONS.has(extname(pluginPath))
}

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

module.exports = { registerTypeScript, addTsErrorInfo }
