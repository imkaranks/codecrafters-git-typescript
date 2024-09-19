import * as fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
  Init = "init",
  CatFile = "cat-file",
  HashObject = "hash-object",
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

    switch (flag) {
      case "-p":
        if (!blobSHA || typeof blobSHA !== "string" || blobSHA.length !== 40) {
          throw new Error(`Invalid blob SHA: ${blobSHA}`);
        }

        const filePath = `.git/objects/${blobSHA.slice(0, 2)}/${blobSHA.slice(
          2
        )}`;

        readAndDecompressFile(filePath);
        break;

      default:
        throw new Error(`Unknown flag ${flag}`);
    }
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

function handleHashObjectCommand() {
  try {
    if (args.length < 3) {
      throw new Error(
        "Insufficient arguments: Expected at least a flag and a blob SHA"
      );
    }

    const flag = args[1];
    const filePath = args[2];

    const fileExists = fs.existsSync(filePath);
    if (!fileExists) {
      throw new Error("file does not exists");
    }

    const fileContent = fs.readFileSync(filePath);
    // const metaData = Buffer.from(`blob ${fileContent.length}\0`);
    // const contents = Buffer.concat([metaData, fileContent]);
    const contents = Buffer.from(`blob ${fileContent.length}\0${fileContent}`);

    const hash = crypto.createHash("sha1").update(contents).digest("hex");
    process.stdout.write(hash);

    switch (flag) {
      case "-w":
        writeGitHashObject(hash, contents);
        break;

      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  } catch (error) {
    console.log(
      error instanceof Error
        ? error.message
        : "Failed to handle hash-object command"
    );
  }
}

function writeGitHashObject(hash: string, contents: Buffer) {
  try {
    const objectDirPath = `.git/objects/${hash.slice(0, 2)}`;
    const objectFilePath = `${objectDirPath}/${hash.slice(2)}`;

    const compressedContents = zlib.deflateSync(contents);

    fs.mkdirSync(objectDirPath);
    fs.writeFileSync(objectFilePath, compressedContents);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to write hash object"
    );
  }
}

switch (command) {
  case Commands.Init:
    initializeGitDirectory();
    break;

  case Commands.CatFile:
    handleCatFileCommand(args);
    break;

  case Commands.HashObject:
    handleHashObjectCommand();
    break;

  default:
    throw new Error(`Unknown command ${command}`);
}
