import * as core from '@actions/core';
import { setup } from './setup.js';

setup().catch(error => core.setFailed(error.message));
