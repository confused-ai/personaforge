from setuptools import setup, find_packages

setup(
    name="personaforge",
    version="0.1.0",
    description="Python SDK for personaforge AI agent framework",
    long_description="HTTP client for personaforge server. "
                     "Mirrors TypeScript createAgent() / agent.run() API.",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[],
    extras_require={
        "async": ["httpx>=0.27"],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
    ],
)
