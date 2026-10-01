module ticketchain::collectibles {
    use std::signer;
    use std::string::{Self, String};
    use std::option;
    use aptos_std::table::{Self, Table};
    use aptos_framework::object;
    use aptos_token_objects::collection;
    use aptos_token_objects::token;

    const E_NOT_TREASURY: u64 = 1;
    const E_DUPLICATE: u64 = 2;
    struct Registry has key { minted: Table<String, address> }

    fun init_module(treasury: &signer) {
        collection::create_unlimited_collection(treasury,
            string::utf8(b"TicketChain event memories; database admission is authoritative"),
            string::utf8(b"TicketChain"), option::none(), string::utf8(b"https://ticketchain.local"));
        move_to(treasury, Registry { minted: table::new() });
    }

    public entry fun mint(treasury: &signer, ticket_id: String, recipient: address, description: String, uri: String) acquires Registry {
        assert!(signer::address_of(treasury) == @ticketchain, E_NOT_TREASURY);
        let registry = borrow_global_mut<Registry>(@ticketchain);
        assert!(!table::contains(&registry.minted, ticket_id), E_DUPLICATE);
        let constructor = token::create_named_token(treasury, string::utf8(b"TicketChain"), description, ticket_id, option::none(), uri);
        let asset = object::object_from_constructor_ref<token::Token>(&constructor);
        table::add(&mut registry.minted, ticket_id, object::object_address(&asset));
        object::transfer(treasury, asset, recipient);
    }

    #[test(treasury = @ticketchain)]
    fun authorized_mint(treasury: &signer) acquires Registry {
        init_module(treasury);
        mint(treasury, string::utf8(b"ticket-1"), @ticketchain, string::utf8(b"Memory"), string::utf8(b"https://example.com"));
        assert!(table::contains(&borrow_global<Registry>(@ticketchain).minted, string::utf8(b"ticket-1")), 10);
    }

    #[test(treasury = @ticketchain, attacker = @0xbeef)]
    #[expected_failure(abort_code = 1, location = Self)]
    fun unauthorized_mint(treasury: &signer, attacker: &signer) acquires Registry {
        init_module(treasury);
        mint(attacker, string::utf8(b"ticket-1"), @ticketchain, string::utf8(b"Memory"), string::utf8(b"https://example.com"));
    }

    #[test(treasury = @ticketchain)]
    #[expected_failure(abort_code = 2, location = Self)]
    fun duplicate_mint(treasury: &signer) acquires Registry {
        init_module(treasury);
        mint(treasury, string::utf8(b"ticket-1"), @ticketchain, string::utf8(b"Memory"), string::utf8(b"https://example.com"));
        mint(treasury, string::utf8(b"ticket-1"), @ticketchain, string::utf8(b"Memory"), string::utf8(b"https://example.com"));
    }
}
