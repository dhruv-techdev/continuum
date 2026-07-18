#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION, PRODUCT_NAME, DESCRIPTION } from '@continuum/core';
import { registerDoctorCommand } from './commands/doctor';
import { registerInitCommand } from './commands/init';

const program = new Command();

program
  .name('continuum')
  .description(`${PRODUCT_NAME} — ${DESCRIPTION}`)
  .version(VERSION, '-v, --version');

registerInitCommand(program);
registerDoctorCommand(program);

program.parse();
