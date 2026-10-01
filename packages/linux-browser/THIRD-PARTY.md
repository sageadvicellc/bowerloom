# Third-party notice

The profile in `assets/seccomp.json` is derived from Microsoft Playwright1.63.0's [Docker seccomp profile](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json). Playwright is copyright Microsoft Corporation and licensed under Apache License2.0. The complete upstream license is included in [PLAYWRIGHT-LICENSE.txt](PLAYWRIGHT-LICENSE.txt).

Trellis modifications restrict socket/socketpair creation to AF_UNIX, remove socketcall and io_uring allowances, return ENOSYS for clone3, and allow chroot without a condition on the outer capability set so Chromium can further restrict its own filesystem inside its user namespace. These modifications do not add outer capabilities or disable Chromium's sandbox.

The public Chrome for Testing and Debian runtime libraries are separately provisioned and not included in this repository. Their complete distributions and accompanying upstream licenses must remain available with the local runtime installation. The bundled runtime manifest records exact files; it does not relicense those components.
