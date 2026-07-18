#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION, PRODUCT_NAME, DESCRIPTION } from '@continuum/core';
import { registerInitCommand } from './commands/init';
import { registerDoctorCommand } from './commands/doctor';
import { registerProjectCommand } from './commands/project';
import { registerSessionCommand } from './commands/session';

const program = new Command();

program
  .name('continuum')
  .description(`${PRODUCT_NAME} — ${DESCRIPTION}`)
  .version(VERSION, '-v, --version');

registerInitCommand(program);
registerDoctorCommand(program);
registerProjectCommand(program);
registerSessionCommand(program);

program.parse();
