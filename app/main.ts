import * as fs from "fs";
import path from "path";
import zlib from "zlib";

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
  Init = "init",
  CatFile = "cat-file",
}

function initializeGitDirectory() {
  fs.mkdirSync(".git", { recursive: true });
  fs.mkdirSync(".git/objects", { recursive: true });
  fs.mkdirSync(".git/refs", { recursive: true });
  fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
  console.log("Initialized git directory");
}

function handleCatFileCommand(args: string[]) {
  try {
    if (args.length < 3) {
      throw new Error(
        "Insufficient arguments: Expected at least a flag and a blob SHA"
      );
    }

    const flag = args[1];
    const blobSHA = args[2];

    if (flag !== "-p") {
      throw new Error(`Unknown flag ${flag}`);
    }
    if (!blobSHA || typeof blobSHA !== "string" || blobSHA.length !== 40) {
      throw new Error(`Invalid blob SHA: ${blobSHA}`);
    }

    const filePath = path.resolve(
      __dirname,
      `../.git/objects/${blobSHA.slice(0, 2)}/${blobSHA.slice(2)}`
    );

    readAndDecompressFile(filePath);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Error handling cat-file command"
    );
  }
}

function readAndDecompressFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const compressedData = fs.readFileSync(filePath);
  let decompressedData: Buffer;

  try {
    decompressedData = zlib.unzipSync(compressedData);
  } catch (error) {
    throw new Error("Failed to decompress the file");
  }

  const nullByteIndex = decompressedData.indexOf(0);
  if (nullByteIndex === -1) {
    throw new Error("Invalid object format: No null byte found");
  }

  const blobContent = decompressedData.subarray(nullByteIndex + 1).toString();
  process.stdout.write(blobContent);
}

switch (command) {
  case Commands.Init:
    initializeGitDirectory();
    break;

  case Commands.CatFile:
    handleCatFileCommand(args);
    break;

  default:
    throw new Error(`Unknown command ${command}`);
}
