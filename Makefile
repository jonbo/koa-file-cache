test:
	@mkdir -p ./test/output/
	@rm -f ./test/output/*
	@./node_modules/.bin/mocha \
		--require should \
		--harmony-generators \
		--reporter spec \
		--bail

clean:
	@rm -rf node_modules
	@rm test/output

.PHONY: all test clean