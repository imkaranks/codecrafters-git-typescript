import * as fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

const args = process.argv.slice(2);
const command = args[0];
const gitIgnoredFiles = getIgnoredDirs();

enum Commands {
  Init = "init",
  CatFile = "cat-file",
  HashObject = "hash-object",
  LsTree = "ls-tree",
  WriteTree = "write-tree",
}

enum TreeEntryModes {
  RegularFile = "100644",
  ExecutableFile = "100755",
  SymbolicLink = "120000",
  Directory = "040000",
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

function handleLsTreeCommand() {
  try {
    if (args.length < 3) {
      throw new Error(
        "Insufficient arguments: Expected at least a flag and a tree SHA"
      );
    }

    const flag = args[1];
    const treeSHA = args[2];

    const treePath = `.git/objects/${treeSHA.slice(0, 2)}/${treeSHA.slice(2)}`;

    if (!fs.existsSync(treePath)) {
      throw new Error("Tree does not exists");
    }

    const compressedContents = fs.readFileSync(treePath);
    let decompressedContents: Buffer;

    try {
      decompressedContents = zlib.unzipSync(compressedContents);
    } catch (error) {
      throw new Error("Failed to decompress the file");
    }

    const contents = decompressedContents
      .toString()
      .split("\0")
      .slice(1, -1)
      .reduce(
        (acc: string[], e) => [...acc, e.split(" ").at(-1) as string],
        []
      );

    console.log(contents);
  } catch (error) {
    console.log(
      error instanceof Error
        ? error.message
        : "Failed to handle ls-tree command"
    );
  }
}

function handleWriteTreeCommand() {
  const fileMp = new Map<string, string[]>();
  const treeMp = new Map<string, string[]>();
  const dirToTreeHashMp = new Map<string, string>();

  function traverseFiles(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    files.forEach((file) => {
      if (gitIgnoredFiles.includes(file.name)) return;

      const fullPath = path.join(dir, file.name);
      const fileStat = fs.statSync(fullPath);

      if (file.isDirectory()) {
        fileMp.set(dir, [...(fileMp.get(dir) || []), file.name]);

        traverseFiles(fullPath);

        if (fileMp.get(fullPath)) {
          fileMpToTreeMp(fullPath);
        }
      } else if (file.isFile()) {
        fileMp.set(dir, [...(fileMp.get(dir) || []), file.name]);
      }
    });

    if (fileMp.get(dir)) {
      fileMpToTreeMp(dir);
    }
  }

  traverseFiles(process.cwd());

  function fileMpToTreeMp(fileSrcPath: string) {
    const files = fileMp.get(fileSrcPath);

    if (files) {
      const bufferContent: string[] = [];

      files.forEach((file) => {
        const filePath = path.join(fileSrcPath, file);
        const fileStat = fs.statSync(filePath);

        if (fileStat.isDirectory() && dirToTreeHashMp.get(filePath)) {
          const hash = dirToTreeHashMp.get(filePath);
          bufferContent.push(`${TreeEntryModes.Directory} ${file}\0${hash}`);
        } else if (fileStat.isFile()) {
          const fileContent = fs.readFileSync(filePath);
          const blobMetaData = Buffer.from(`blob ${fileContent.length}\0`);
          const blobContent = Buffer.concat([blobMetaData, fileContent]);
          const hash = crypto
            .createHash("sha1")
            .update(blobContent)
            .digest("hex");

          // TODO: handle add blob file in git objects
          const objectDirPath = `.git/objects/${hash.slice(0, 2)}`;
          const objectFilePath = `${objectDirPath}/${hash.slice(2)}`;
          const compressedContents = zlib.deflateSync(blobContent);
          if (!fs.existsSync(objectDirPath)) {
            fs.mkdirSync(objectDirPath);
          }
          fs.writeFileSync(objectFilePath, compressedContents);

          const isExecutable = !!(fileStat.mode & 0o111);
          const mode = isExecutable
            ? TreeEntryModes.ExecutableFile
            : TreeEntryModes.RegularFile;

          bufferContent.push(`${mode} ${file}\0${hash}`);
        }
      });

      // const fileContent = bufferContent.join("\n");
      const fileContent = Buffer.from(bufferContent.join("\n"));
      const hash = crypto.createHash("sha1").update(fileContent).digest("hex");

      // TODO: handle add tree file in git objects
      const objectDirPath = `.git/objects/${hash.slice(0, 2)}`;
      const objectFilePath = `${objectDirPath}/${hash.slice(2)}`;
      const compressedContents = zlib.deflateSync(fileContent);
      if (!fs.existsSync(objectDirPath)) {
        fs.mkdirSync(objectDirPath);
      }
      fs.writeFileSync(objectFilePath, compressedContents);

      treeMp.set(hash, bufferContent);
      dirToTreeHashMp.set(fileSrcPath, `${hash}`);
    }
  }

  // console.log(fileMp, treeMp, dirToTreeHashMp);
  // console.log(treeMp);

  const treeSHA = dirToTreeHashMp.get(process.cwd());

  if (treeSHA) {
    console.log(treeSHA);
  }
}

function getIgnoredDirs() {
  const contents = fs.readFileSync(path.resolve(process.cwd(), ".gitignore"));

  return (
    contents
      .toString()
      .split("\n")
      // remove comments
      .filter((dir) => !dir.startsWith("# "))
  );
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

  case Commands.LsTree:
    handleLsTreeCommand();
    break;

  case Commands.WriteTree:
    handleWriteTreeCommand();
    break;

  default:
    throw new Error(`Unknown command ${command}`);
}
