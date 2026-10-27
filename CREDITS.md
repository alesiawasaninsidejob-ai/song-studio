# Song Studio credits

Song Studio is free and runs entirely in your browser.

- **Singing voice:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad, Apache-2.0. We use the ONNX export from [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (8-bit). The graph was modified so that phoneme durations and the pitch curve are inputs, which lets the melody drive the voice. The voice style files (`voices/*.bin`) come from the same release.
- **Neural runtime:** [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22, MIT License, © Microsoft Corporation.
- **Phonemizer:** [phonemizer.js](https://github.com/xenova/phonemizer.js), Apache-2.0. It bundles [eSpeak NG](https://github.com/espeak-ng/espeak-ng), GPL-3.0. Source is available at those links.
- Music synthesis, composition, lyrics and the app itself are original code.
