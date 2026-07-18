#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION, PRODUCT_NAME, DESCRIPTION } from '@continuum/core';
import { registerDoctorCommand } from './commands/doctor';

const program = new Command();

program
  .name('continuum')
  .description(`${PRODUCT_NAME} — ${DESCRIPTION}`)
  .version(VERSION, '-v, --version');

registerDoctorCommand(program);

program.parse();
