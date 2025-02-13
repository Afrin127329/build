import { writeFile, rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { trace, TraceFlags, propagation } from '@opentelemetry/api'
import { getBaggage } from '@opentelemetry/api/build/src/baggage/context-helpers.js'
import test from 'ava'

import { setMultiSpanAttributes, startTracing, stopTracing, loadBaggageFromFile } from '../../lib/tracing/main.js'

test('Tracing set multi span attributes', async (t) => {
  const ctx = setMultiSpanAttributes({ some: 'test', foo: 'bar' })
  const baggage = getBaggage(ctx)
  t.is(baggage.getEntry('some').value, 'test')
  t.is(baggage.getEntry('foo').value, 'bar')
})

const testMatrixBaggageFile = [
  {
    description: 'when baggageFilePath is blank',
    input: {
      baggageFilePath: '',
      baggageFileContent: null,
    },
    expects: {
      somefield: undefined,
      foo: undefined,
    },
  },
  {
    description: 'when baggageFilePath is set but file is empty',
    input: {
      baggageFilePath: 'baggage.dump',
      baggageFileContent: '',
    },
    expects: {
      somefield: undefined,
      foo: undefined,
    },
  },
  {
    description: 'when baggageFilePath is set and has content',
    input: {
      baggageFilePath: 'baggage.dump',
      baggageFileContent: 'somefield=value,foo=bar',
    },
    expects: {
      somefield: { value: 'value' },
      foo: { value: 'bar' },
    },
  },
]

let baggagePath
test.before(async () => {
  baggagePath = await mkdtemp(join(tmpdir(), 'baggage-path-'))
})

test.after(async () => {
  await rm(baggagePath, { recursive: true })
})

testMatrixBaggageFile.forEach((testCase) => {
  test.serial(`Tracing baggage loading - ${testCase.description}`, async (t) => {
    const { input, expects } = testCase

    // We only want to write the file if it's a non-empty string '', while we still want to test scenario
    let filePath = input.baggageFilePath
    if (input.baggageFilePath.length > 0) {
      filePath = `${baggagePath}/${input.baggageFilePath}`
      await writeFile(filePath, input.baggageFileContent)
    }

    const ctx = loadBaggageFromFile(filePath)
    const baggage = propagation.getBaggage(ctx)

    // When there's no file we test that baggage is not set
    if (input.baggageFilePath === '') {
      t.is(baggage, undefined)
      return
    }

    Object.entries(expects).forEach(([property, expected]) => {
      if (expected === undefined) {
        t.is(baggage.getEntry(property), expected)
      } else {
        t.is(baggage.getEntry(property).value, expected.value)
      }
    })
  })
})

const spanId = '6e0c63257de34c92'
// The sampler is deterministic, meaning that for a given traceId it will always produce a `SAMPLED` or a `NONE`
// consistently. More info in - https://opentelemetry.io/docs/specs/otel/trace/tracestate-probability-sampling/#consistent-probability-sampling
// As such given a specific traceId we can always expect a sampled or note sampled behaviour
const notSampledTraceId = 'd4cda95b652f4a1592b449d5929fda1b'
const sampledTraceId = 'e1819d7355971fd50456e41dbed71e58'

const testMatrix = [
  {
    description: 'when sampled, only include the SampleRate attribute by default',
    input: {
      traceId: sampledTraceId,
      sampleRate: 4,
    },
    expects: {
      traceId: sampledTraceId,
      traceFlags: TraceFlags.SAMPLED,
      attributes: { SampleRate: 4 },
    },
  },
  {
    description: 'when not sampled, attributes should be undefined and trace flags should be 0',
    input: {
      traceId: notSampledTraceId,
      sampleRate: 4,
    },
    expects: {
      traceId: notSampledTraceId,
      traceFlags: TraceFlags.NONE,
      attributes: undefined,
    },
  },
  {
    description: 'trace flags are ignored by the deterministic sampler',
    input: {
      traceId: sampledTraceId,
      traceFlags: TraceFlags.NONE,
      sampleRate: 4,
    },
    expects: {
      traceId: sampledTraceId,
      traceFlags: TraceFlags.SAMPLED,
      attributes: { SampleRate: 4 },
    },
  },
]

test.beforeEach('cleanup tracing', async () => {
  await stopTracing()
})

testMatrix.forEach((testCase) => {
  const noopLogger = () => {}

  // Tests need to run serially since the tracing context is global state
  test.serial(`Tracing spans - ${testCase.description}`, async (t) => {
    const { input, expects } = testCase
    const ctx = startTracing(
      {
        enabled: true,
        httpProtocol: 'http',
        host: 'localhost',
        port: 4127,
        sampleRate: input.sampleRate,
        traceId: input.traceId,
        traceFlags: input.traceFlags,
        parentSpanId: spanId,
        baggageFilePath: '',
      },
      noopLogger,
    )

    const tracer = trace.getTracer('test')
    const span = tracer.startSpan('test', {}, ctx)

    t.is(span.spanContext().traceId, expects.traceId)
    t.is(span.spanContext().traceFlags, expects.traceFlags)
    t.deepEqual(span.attributes, expects.attributes)
  })
})
