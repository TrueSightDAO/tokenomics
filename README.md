## Pre-requisites
  - Python version 3.11.6
  

## Setup

Setup version of Python in folder
```
pyenv local 3.11.6
```

Setup Virtual Environment
```
pip install virtualenv
virtualenv -p 3.11.6 venv
```

Activating virtual environment
```
source ./venv/bin/activate
```

Install all dependencies
```
pip install -r requirements.txt
```

Backup all requirements
```
pip freeze > requirements.txt
```

