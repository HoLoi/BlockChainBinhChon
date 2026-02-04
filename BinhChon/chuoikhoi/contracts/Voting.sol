// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Voting cho tất cả mọi người
contract Voting {
    struct Poll {
        string title;
        string description;
        string[] options;
        uint256[] votes;
        uint64 startTime;
        uint64 endTime;
        bool active;
        address creator;
    }

    address public owner;
    Poll[] private polls;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event PollCreated(
        uint256 indexed pollId,
        string title,
        uint64 startTime,
        uint64 endTime,
        address indexed creator
    );
    event Voted(uint256 indexed pollId, uint256 indexed optionId, address indexed voter);
    event PollClosed(uint256 indexed pollId, address indexed closedBy);

    modifier onlyOwner() {
        require(msg.sender == owner, "not-owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function totalPolls() external view returns (uint256) {
        return polls.length;
    }

    function createPoll(
        string memory title,
        string memory description,
        string[] memory options,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256) {
        require(bytes(title).length > 0, "title-required");
        require(options.length >= 2, "need-2-options");

        if (startTime == 0) {
            startTime = uint64(block.timestamp);
        }

        if (endTime != 0) {
            require(endTime > startTime, "end-after-start");
        }

        uint256[] memory emptyVotes = new uint256[](options.length);

        polls.push(
            Poll({
                title: title,
                description: description,
                options: options,
                votes: emptyVotes,
                startTime: startTime,
                endTime: endTime,
                active: true,
                creator: msg.sender
            })
        );

        uint256 pollId = polls.length - 1;
        emit PollCreated(pollId, title, startTime, endTime, msg.sender);
        return pollId;
    }

    function vote(uint256 pollId, uint256 optionId) external {
        require(pollId < polls.length, "poll-not-found");
        Poll storage poll = polls[pollId];
        require(poll.active, "poll-closed");
        require(optionId < poll.options.length, "bad-option");
        require(!hasVoted[pollId][msg.sender], "already-voted");
        require(block.timestamp >= poll.startTime, "not-started");
        if (poll.endTime != 0) {
            require(block.timestamp <= poll.endTime, "poll-ended");
        }

        poll.votes[optionId] += 1;
        hasVoted[pollId][msg.sender] = true;
        emit Voted(pollId, optionId, msg.sender);
    }

    function closePoll(uint256 pollId) external onlyOwner {
        require(pollId < polls.length, "poll-not-found");
        Poll storage poll = polls[pollId];
        require(poll.active, "already-closed");
        poll.active = false;
        emit PollClosed(pollId, msg.sender);
    }

    function getPoll(uint256 pollId)
        external
        view
        returns (
            string memory title,
            string memory description,
            string[] memory options,
            uint256[] memory votes,
            uint64 startTime,
            uint64 endTime,
            bool active,
            address creator
        )
    {
        require(pollId < polls.length, "poll-not-found");
        Poll storage poll = polls[pollId];
        return (
            poll.title,
            poll.description,
            poll.options,
            poll.votes,
            poll.startTime,
            poll.endTime,
            poll.active,
            poll.creator
        );
    }

    function hasAddressVoted(uint256 pollId, address voter) external view returns (bool) {
        require(pollId < polls.length, "poll-not-found");
        return hasVoted[pollId][voter];
    }
}
