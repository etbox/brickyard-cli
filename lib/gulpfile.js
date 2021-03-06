const childProcess = require('child_process')
const _ = require('lodash')
const argv = require('../bin')
const brickyard = require('./brickyard')
const hack = require('./hack')
const docker = require('./docker')
const { runFlatten } = require('./hack/gulp')

hack.logWithLevel(argv.verbose)

const myTasks = {}

const BRICKYARD_CHILD_PROCESS_FLAG = '--brickyard-child-process-flag'
const BRICKYARD_CHILD_PROCESS_BUILD_FINISHED = 'brickyard-child-process-build-finished'
const BRICKYARD_CHILD_PROCESS_RUN_FINISHED = 'brickyard-child-process-run-finished'
const BRICKYARD_CHILD_PROCESS_RUN_AGAIN = 'brickyard-child-process-run-again'
const isMaster = process.argv.indexOf(BRICKYARD_CHILD_PROCESS_FLAG) === -1

function listModule(container) {
	let maxLength = _.maxBy(_.keys(container), 'length')
	maxLength = maxLength ? maxLength.length + 2 : 0
	maxLength = Math.max(maxLength, 20)
	const content = []
	_.each(container, (md) => {
		const printName = _.padEnd(`[${md.name}]`, maxLength, ' ')
		const printDesc = md.description || ''
		content.push(`    ${printName}    ${printDesc}`)
	})
	return content
}

async function scanAndPreparePlan() {
	const { brickyard_modules, plan } = argv // eslint-disable-line camelcase

	await brickyard.scanAsync(brickyard_modules, `${__dirname}/../brickyard_modules`)

	if (!_.isEmpty(plan)) {
		brickyard.preparePlan(...plan)
	}
}

myTasks.ls = async () => {
	const { plan } = argv

	await scanAndPreparePlan()

	if (!_.isEmpty(brickyard.allModules.unknow)) {
		console.warn('Unknow type modules found. It may be a declaration error.')
		listModule(brickyard.allModules.unknow).forEach((str) => { console.warn(str) })
	}

	// list plan
	if (_.isEmpty(plan)) {
		console.log('plan modules:')
		listModule(brickyard.allModules.plan).forEach((str) => { console.log(str) })
		return
	}

	// list modules of plans
	console.log(`${plan.join(',')} modules`)
	_.forEach(['plan', 'buildtask', 'frontend', 'backend'], (type) => {
		const modules = brickyard.modules[type]
		if (!_.isEmpty(modules)) {
			console.log(`  ${type} modules:`)
			listModule(modules).forEach((str) => { console.log(str) })
		}
	})
}

function fork() {
	const md = process.argv[1]
	const param = _.concat(_.drop(process.argv, 2), BRICKYARD_CHILD_PROCESS_FLAG)
	const handle = childProcess.fork(md, param)

	console.debug(`Process[${process.pid}] fork Process[${handle.pid}] with cmd:`)
	console.debug(`${md} ${param.join(' ')} ${process.execArgv.join(' ')}`)
	return handle
}

function forkAndWaitMsg() {
	return new Promise((resolve, reject) => {
		const handler = fork()
		handler.once('message', (msg) => {
			if (msg === BRICKYARD_CHILD_PROCESS_BUILD_FINISHED) {
				resolve(handler)
			} else {
				reject()
			}
		})
	}).then((handler) => {
		handler.once('message', (msg) => {
			if (msg === BRICKYARD_CHILD_PROCESS_RUN_AGAIN) {
				forkAndWaitMsg()
			} else {
				throw new Error(`Can not handle ${msg} at this time.`)
			}
		})
	})
}

async function buildWithPairProcess({ dir, config }) {
	if (isMaster) { // master fork
		await forkAndWaitMsg()
	} else { // worker build
		await scanAndPreparePlan()
		await brickyard.saveAsync(dir, config)
		brickyard.prepareDependencies()
		brickyard.hackDependencies()
		brickyard.inject(argv)
		brickyard.loadModules('buildtask')
		await runFlatten('build')
		console.log('build finished')
		process.send(BRICKYARD_CHILD_PROCESS_BUILD_FINISHED)
	}
}

myTasks.build = async () => {
	await buildWithPairProcess(argv)
	const { dir, run, watch } = argv
	if (isMaster) {
		if (watch) {
			await brickyard.loadRuntime(argv)
			brickyard.sendSignals('watch-output')
		}
	} else {
		if (run) {
			await brickyard.loadSettingAsync(dir)
			brickyard.loadModules('backend')
			brickyard.sendSignals('run')
		}
		if (watch) {
			brickyard.sendSignals('watch-frontend', 'watch-backend')
		}
	}
}

myTasks.test = async () => {
	await buildWithPairProcess(argv)
	const { dir, watch } = argv
	if (isMaster) {
		// do nothing
	} else {
		await brickyard.loadSettingAsync(dir)
		brickyard.loadModules('backend')
		await runFlatten('test')
		if (watch) {
			brickyard.sendSignals('watch-frontend', 'watch-backend')
		}
	}
}

myTasks.run = async () => {
	const { instances } = argv
	if (instances === 1) {
		await brickyard.loadRuntime(argv)
		brickyard.sendSignals('run')
		return
	}
	if (!(typeof instances === 'number' && instances > 0)) {
		throw new Error(`Invalid instances value: ${instances}`)
	}

	if (isMaster) {
		const workerFinished = []
		for (let i = 0; i < instances; i += 1) {
			workerFinished.push(new Promise((resolve, reject) => {
				fork().once('message', (msg) => {
					if (msg === BRICKYARD_CHILD_PROCESS_RUN_FINISHED) {
						resolve()
					} else {
						reject(msg)
					}
				})
			}))
		}
		await Promise.all(workerFinished)
	} else {
		await brickyard.loadRuntime(argv)
		brickyard.sendSignals('run')
		process.send(BRICKYARD_CHILD_PROCESS_RUN_FINISHED)
	}
}

myTasks['create-module'] = async () => {
	const { type, dir, name } = argv

	const md = await brickyard.Class.createModule(type, dir, name)
	console.log(`${md.type} module ${md.name} created at ${dir}`)
}

myTasks['build-docker'] = async () => {
	const {
		plan, dir, config, expose, tag,
	} = argv
	const onlyDockerfile = argv['only-dockerfile']
	await scanAndPreparePlan()
	await brickyard.saveAsync(dir, config)
	brickyard.prepareDependencies()

	const dockerfile = await docker.writeDockerfile(dir, brickyard.modules, {
		plans: plan.join(' '),
		configPath: config,
		onlyDockerfile,
		expose,
		packageJson: brickyard.getPackageJson(),
	})
	if (!onlyDockerfile) {
		docker.runDockerBuild(dockerfile, tag)
	}
}

myTasks[argv._[0]]().catch((e) => {
	console.error(e.message || e)
	console.debug(e.stack)
	process.exit(1)
})
