#!/usr/bin/env node
import { createProject } from './src/project.mjs';
import { generateModule } from './src/module.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('create-arcbase DIRECTORY --database sqlite|postgres [--brand NAME]\ncreate-arcbase module SPEC.json --project DIRECTORY');
  } else if (args[0] === 'module') {
    if (args.length !== 4 || args[2] !== '--project') throw new Error('Use module SPEC.json --project DIRECTORY');
    console.log(JSON.stringify(generateModule(resolve(args[3]), JSON.parse(readFileSync(resolve(args[1]), 'utf8')))));
  } else {
    const options = {};
    for (let i = 1; i < args.length; i += 2) {
      if (!['--database', '--brand'].includes(args[i]) || !args[i + 1]) throw new Error('Unknown or missing option');
      if (options[args[i].slice(2)] !== undefined) throw new Error('Duplicate option');
      options[args[i].slice(2)] = args[i + 1];
    }
    console.log(JSON.stringify(createProject(resolve(args[0]), options)));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
