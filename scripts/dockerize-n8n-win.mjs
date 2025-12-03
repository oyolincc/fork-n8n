#!/usr/bin/env node
/**
 * Build n8n Docker image locally
 *
 * This script simulates the CI build process for local testing.
 * Default output: 'n8nio/n8n:local'
 * Override with IMAGE_BASE_NAME and IMAGE_TAG environment variables.
 */

import { $, echo, fs, chalk, os } from 'zx';
import { fileURLToPath } from 'url';
import path from 'path';

// Disable verbose mode for cleaner output
$.verbose = false;
process.env.FORCE_COLOR = '1';

// #region ===== Helper Functions =====

/**
 * Convert Windows path to Unix-style path for Git Bash/WSL compatibility
 * @param {string} filePath - Windows path
 * @returns {string} Unix-style path
 */
function toUnixPath(filePath) {
	if (process.platform === 'win32') {
		// Normalize the path and convert backslashes to forward slashes
		let normalized = path.normalize(filePath).replace(/\\/g, '/');
		
		// Convert Windows drive letter (e.g., C:/) to Unix-style (/c/)
		// This is specifically for Git Bash compatibility
		const driveMatch = normalized.match(/^([A-Za-z]):\//);
		if (driveMatch) {
			const driveLetter = driveMatch[1].toLowerCase();
			normalized = `/${driveLetter}/${normalized.slice(3)}`;
		}
		
		return normalized;
	}
	return filePath;
}

/**
 * Get Docker platform string based on host architecture
 * @returns {string} Platform string (e.g., 'linux/amd64')
 */
function getDockerPlatform() {
	const arch = os.arch();
	const dockerArch = {
		x64: 'amd64',
		arm64: 'arm64',
	}[arch];

	if (!dockerArch) {
		throw new Error(`Unsupported architecture: ${arch}. Only x64 and arm64 are supported.`);
	}

	return `linux/${dockerArch}`;
}

/**
 * Format duration in seconds
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
	return `${Math.floor(ms / 1000)}s`;
}

/**
 * Get Docker image size
 * @param {string} imageName - Full image name with tag
 * @returns {Promise<string>} Image size or 'Unknown'
 */
async function getImageSize(imageName) {
	try {
		const { stdout } = await $`docker images ${imageName} --format "{{.Size}}"`;
		return stdout.trim();
	} catch {
		return 'Unknown';
	}
}

/**
 * Check if a command exists
 * @param {string} command - Command to check
 * @returns {Promise<boolean>} True if command exists
 */
async function commandExists(command) {
	try {
		if (process.platform === 'win32') {
			// On Windows, use 'where' command
			await $`where ${command}`;
		} else {
			await $`command -v ${command}`;
		}
		return true;
	} catch {
		return false;
	}
}

const SupportedContainerEngines = /** @type {const} */ (['docker', 'podman']);

/**
 * Detect if the local `docker` CLI is actually Podman via the docker shim.
 * @returns {Promise<boolean>}
 */
async function isDockerPodmanShim() {
	try {
		const { stdout } = await $`docker version`;
		return stdout.toLowerCase().includes('podman');
	} catch {
		return false;
	}
}

/**
 * @returns {Promise<(typeof SupportedContainerEngines[number])>}
 */
async function getContainerEngine() {
	// Allow explicit override via env var
	const override = process.env.CONTAINER_ENGINE?.toLowerCase();
	if (override && /** @type {readonly string[]} */ (SupportedContainerEngines).includes(override)) {
		return /** @type {typeof SupportedContainerEngines[number]} */ (override);
	}

	const hasDocker = await commandExists('docker');
	const hasPodman = await commandExists('podman');

	if (hasDocker) {
		// If docker is actually a Podman shim, use podman path to avoid unsupported flags like --load
		if (hasPodman && (await isDockerPodmanShim())) {
			return 'podman';
		}
		return 'docker';
	}

	if (hasPodman) return 'podman';

	throw new Error('No supported container engine found. Please install Docker or Podman.');
}

// #endregion ===== Helper Functions =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isInScriptsDir = path.basename(__dirname) === 'scripts';
const rootDir = isInScriptsDir ? path.resolve(__dirname, '..') : path.resolve(__dirname);

const config = {
	dockerfilePath: path.join(rootDir, 'docker/images/n8n/Dockerfile'),
	imageBaseName: process.env.IMAGE_BASE_NAME || 'n8nio/n8n',
	imageTag: process.env.IMAGE_TAG || 'local',
	buildContext: rootDir,
	compiledAppDir: path.join(rootDir, 'compiled'),
	get fullImageName() {
		return `${this.imageBaseName}:${this.imageTag}`;
	},
};
console.log(chalk.blueBright('config: ', JSON.stringify(config, null, 2)))

// #region ===== Main Build Process =====

const platform = getDockerPlatform();

async function main() {
	echo(chalk.blue.bold('===== Docker Build for n8n ====='));
	echo(`INFO: Image: ${config.fullImageName}`);
	echo(`INFO: Platform: ${platform}`);
	echo(chalk.gray('-'.repeat(47)));

	await checkPrerequisites();

	// Build Docker image
	const buildTime = await buildDockerImage();

	// Get image details
	const imageSize = await getImageSize(config.fullImageName);

	// Display summary
	displaySummary({
		imageName: config.fullImageName,
		platform,
		size: imageSize,
		buildTime,
	});
}

async function checkPrerequisites() {
	if (!(await fs.pathExists(config.compiledAppDir))) {
		echo(chalk.red(`Error: Compiled app directory not found at ${config.compiledAppDir}`));
		echo(chalk.yellow('Please run build-n8n.mjs first!'));
		process.exit(1);
	}

	// Ensure at least one supported container engine is available
	if (!(await commandExists('docker')) && !(await commandExists('podman'))) {
		echo(chalk.red('Error: Neither Docker nor Podman is installed or in PATH'));
		process.exit(1);
	}
}

async function buildDockerImage() {
	const startTime = Date.now();
	const containerEngine = await getContainerEngine();
	echo(chalk.yellow(`INFO: Building Docker image using ${containerEngine}...`));

	// Convert paths to Unix-style for Docker commands (important for Git Bash on Windows)
	const dockerfilePath = toUnixPath(config.dockerfilePath);
	const buildContext = toUnixPath(config.buildContext);

	try {
		if (containerEngine === 'podman') {
			// For Podman, we need to be more careful with path handling
			const buildArgs = [
				'build',
				'--platform', platform,
				'--build-arg', `TARGETPLATFORM=${platform}`,
				'-t', config.fullImageName,
				'-f', dockerfilePath,
				buildContext
			];
			
			const result = await $`podman ${buildArgs}`;
			echo(result.stdout);
		} else {
			// For Docker, also use array-based arguments to avoid path issues
			const buildArgs = [
				'build',
				'--platform', platform,
				'--build-arg', `TARGETPLATFORM=${platform}`,
				'-t', config.fullImageName,
				'-f', dockerfilePath,
				'--load',
				buildContext
			];
			
			const result = await $`docker ${buildArgs}`;
			echo(result.stdout);
		}

		return formatDuration(Date.now() - startTime);
	} catch (error) {
		echo(chalk.red(`ERROR: Docker build failed: ${error.stderr || error.message}`));
		if (error.stdout) {
			echo(chalk.gray('Build output:'));
			echo(error.stdout);
		}
		process.exit(1);
	}
}

function displaySummary({ imageName, platform, size, buildTime }) {
	echo('');
	echo(chalk.green.bold('═'.repeat(54)));
	echo(chalk.green.bold('           DOCKER BUILD COMPLETE'));
	echo(chalk.green.bold('═'.repeat(54)));
	echo(chalk.green(`✅ Image built: ${imageName}`));
	echo(`   Platform: ${platform}`);
	echo(`   Size: ${size}`);
	echo(`   Build time: ${buildTime}`);
	echo(chalk.green.bold('═'.repeat(54)));
	echo('');
	echo(chalk.cyan('Next steps:'));
	echo(`   • Run the image:  docker run -it --rm -p 5678:5678 ${imageName}`);
	echo(`   • Tag for push:   docker tag ${imageName} <your-registry>/<your-image>:tag`);
}

// #endregion ===== Main Build Process =====

main().catch((error) => {
	echo(chalk.red(`Unexpected error: ${error.message}`));
	if (error.stack) {
		echo(chalk.gray(error.stack));
	}
	process.exit(1);
});